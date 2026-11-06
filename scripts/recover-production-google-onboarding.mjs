import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  googleOnboardingScope,
  googleOnboardingDeliveryAllowed,
} from "../dist-server/server/googleOnboardingPolicy.js";
import { createSupabaseAdminClient } from "../dist-server/server/supabase/adminClient.js";
import {
  getCalendarSubscriptionById,
  PilotApiError,
} from "../dist-server/server/pilotRepository.js";
import { getGoogleCredential } from "../dist-server/server/googleCalendarRepository.js";
import {
  previewGoogleSubscriptionSync,
  syncGoogleSubscription,
  checkGoogleCredentialProviderAuthorization,
} from "../dist-server/server/googleCalendarSync.js";
import { loadPublishedTimetableSnapshot } from "../dist-server/server/publishedTimetableSnapshot.js";
import { projectPublishedTimetable } from "../dist-server/src/domain/publishedCalendarProjection.js";
import { withExternalRequestBudget } from "../dist-server/server/externalRequestBudget.js";
import {
  claimGoogleCalendarSubscriptionDelivery,
  deliverGoogleCalendarJob,
} from "../dist-server/server/googleCalendarDelivery.js";

export async function runProductionGoogleOnboarding(env, mode) {
  const scope = googleOnboardingScope(env);
  if (
    env.GITHUB_REF !== "refs/heads/Calender" ||
    !scope ||
    scope.phase !== "deliver" ||
    !["preview", "deliver"].includes(mode)
  )
    throw new Error("GOOGLE_ONBOARDING_SCOPE_INVALID");
  const response = await fetch(
    "https://backend.calender.aido.co.zw/__release",
    {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  const identity = await response.json();
  if (
    !response.ok ||
    identity.stage !== "cloudflare-production" ||
    identity.sourceSha !== env.SOURCE_SHA ||
    identity.legacyBackendBridge !== false
  )
    throw new Error("GOOGLE_ONBOARDING_RELEASE_MISMATCH");
  const subscription = await getCalendarSubscriptionById(
    scope.subscription,
    env,
  );
  const credential = await getGoogleCredential(scope.subscription, env);
  if (
    !subscription ||
    !googleOnboardingDeliveryAllowed(env, subscription, credential?.updated_at)
  )
    throw new Error("GOOGLE_ONBOARDING_CONSENT_REQUIRED");
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "cleanup=true\n");

  if (scope.mode === "new" && !subscription.external_calendar_id) {
    const marker = await createSupabaseAdminClient(env)
      .from("google_calendar_delivery_jobs")
      .select("calendar_creation_started_at")
      .eq("subscription_id", scope.subscription)
      .maybeSingle();
    if (marker.error) throw new Error("GOOGLE_ONBOARDING_JOB_UNAVAILABLE");
    if (marker.data?.calendar_creation_started_at)
      throw new Error("GOOGLE_CALENDAR_CREATION_UNCERTAIN");
  }

  const preview = await withExternalRequestBudget(40, async () => {
    if (subscription.external_calendar_id)
      return previewGoogleSubscriptionSync(scope.subscription, env);
    await checkGoogleCredentialProviderAuthorization(scope.subscription, env);
    const { timetable, revision } = await loadPublishedTimetableSnapshot(
      scope.timetable,
      env,
    );
    const projection = projectPublishedTimetable({
      timetable: {
        ...timetable,
        publishedAt: revision.updatedAt,
        versionNumber: revision.sequence,
      },
      reminderOffsetsMinutes: subscription.reminder_offsets_minutes ?? [],
      examReminderOffsetsMinutes:
        subscription.exam_reminder_offsets_minutes ?? [],
      publicOrigin: "https://calender.aido.co.zw",
    });
    if (
      scope.mode !== "new" ||
      revision.sequence !== scope.revision ||
      projection.events.length > scope.maxCreates ||
      projection.events.length > 32
    )
      throw new Error("GOOGLE_ONBOARDING_PROJECTION_REJECTED");
    return {
      newCalendarRequired: true,
      expectedEvents: projection.events.length,
      wouldCreate: projection.events.length,
      wouldUpdate: 0,
      wouldDelete: 0,
      ownershipReviewCount: 0,
      publishedRevision: revision.sequence,
      remoteContentsVerified: false,
    };
  });
  const summary = {
    expectedEvents: preview.expectedEvents,
    creates: preview.wouldCreate,
    updates: preview.wouldUpdate,
    deletes: preview.wouldDelete,
    revision: preview.publishedRevision,
    newCalendarRequired: Boolean(preview.newCalendarRequired),
    providerAuthenticated: true,
  };
  if (mode === "preview") return { readOnly: true, ...summary };
  if (
    preview.wouldDelete ||
    preview.ownershipReviewCount ||
    preview.publishedRevision !== scope.revision ||
    (scope.mode === "reconnect" &&
      preview.wouldCreate !== preview.wouldCreateExaminations)
  )
    throw new Error("GOOGLE_ONBOARDING_PREVIEW_REJECTED");
  const current = await createSupabaseAdminClient(env)
    .from("google_calendar_delivery_jobs")
    .select(
      "desired_revision,requested_generation,reconnect_required_at,successful_revision,successful_generation",
    )
    .eq("subscription_id", scope.subscription)
    .maybeSingle();
  if (
    current.error ||
    !current.data ||
    current.data.reconnect_required_at ||
    Number(current.data.desired_revision) !== scope.deliveryRevision ||
    Number(current.data.requested_generation) !== scope.deliveryGeneration
  )
    throw new Error("GOOGLE_ONBOARDING_JOB_CHANGED");
  for (let attempt = 0; attempt < 16; attempt++) {
    if (!googleOnboardingScope(env))
      throw new Error("GOOGLE_ONBOARDING_SCOPE_EXPIRED");
    const job = await claimGoogleCalendarSubscriptionDelivery(
      scope.subscription,
      300,
      env,
    );
    if (!job) {
      if (
        preview.remoteContentsVerified &&
        preview.wouldUpdate === 0 &&
        Number(current.data.successful_revision) >= scope.deliveryRevision &&
        Number(current.data.successful_generation) >= scope.deliveryGeneration
      )
        return {
          readOnly: false,
          remotelyVerified: true,
          alreadyConverged: true,
        };
      throw new Error("GOOGLE_ONBOARDING_JOB_NOT_CLAIMED");
    }
    let verified = false,
      continuation = false;
    const finished = await deliverGoogleCalendarJob(
      job,
      async (_claimed, signal) => {
        try {
          await syncGoogleSubscription(scope.subscription, env, {
            signal,
            maxExternalRequests: 40,
            leaseToken: job.leaseToken,
          });
        } catch (error) {
          continuation = error?.code === "GOOGLE_SYNC_CONTINUE";
          throw error;
        }
        const after = await withExternalRequestBudget(40, () =>
          previewGoogleSubscriptionSync(scope.subscription, env),
        );
        verified = Boolean(
          googleOnboardingScope(env) &&
          after.remoteContentsVerified &&
          after.wouldUpdate === 0 &&
          after.connectionGeneration === scope.connectionGeneration &&
          after.publishedRevision === scope.revision,
        );
        return { completed: verified };
      },
      { env },
    );
    if (finished && verified)
      return {
        readOnly: false,
        remotelyVerified: true,
        successfulDeliveryRevision: job.revision,
      };
    if (!finished || !continuation)
      throw new Error("GOOGLE_ONBOARDING_NOT_CONVERGED");
    await delay(16_000);
  }
  throw new Error("GOOGLE_ONBOARDING_CONTINUATION_REQUIRED");
}
if (process.argv[1]?.endsWith("recover-production-google-onboarding.mjs")) {
  try {
    console.log(
      JSON.stringify(
        await runProductionGoogleOnboarding(
          process.env,
          process.env.RECOVERY_MODE,
        ),
      ),
    );
  } catch (error) {
    const code =
      error?.details?.providerError === "invalid_grant"
        ? "GOOGLE_PROVIDER_INVALID_GRANT"
        : error instanceof PilotApiError
          ? error.code
          : error?.message;
    console.error(
      /^(GOOGLE|PRODUCTION)_[A-Z_]{1,90}$/.test(code ?? "")
        ? code
        : "GOOGLE_ONBOARDING_FAILED",
    );
    process.exitCode = 1;
  }
}
