import { setTimeout as delay } from "node:timers/promises";
import { googleProductionRecoveryScope } from "../dist-server/server/googleProductionRecoveryPolicy.js";
import {
  getCalendarSubscriptionById,
  PilotApiError,
} from "../dist-server/server/pilotRepository.js";
import { createSupabaseAdminClient } from "../dist-server/server/supabase/adminClient.js";
import {
  previewGoogleSubscriptionSync,
  syncGoogleSubscription,
} from "../dist-server/server/googleCalendarSync.js";
import {
  claimGoogleCalendarSubscriptionDelivery,
  deliverGoogleCalendarJob,
} from "../dist-server/server/googleCalendarDelivery.js";
import { withExternalRequestBudget } from "../dist-server/server/externalRequestBudget.js";

export async function runProductionGoogleRecovery(env, mode) {
  if (
    !["preview", "deliver"].includes(mode) ||
    env.GITHUB_REF !== "refs/heads/Calender"
  )
    throw new Error("PRODUCTION_RECOVERY_UNAVAILABLE");
  const scope = googleProductionRecoveryScope(env);
  if (!scope) throw new Error("PRODUCTION_RECOVERY_SCOPE_INVALID");
  const identityResponse = await fetch(
    "https://backend.calender.aido.co.zw/__release",
    {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  const identity = await identityResponse.json();
  if (
    !identityResponse.ok ||
    identity.stage !== "cloudflare-production" ||
    identity.sourceSha !== env.SOURCE_SHA ||
    !identity.workerVersion ||
    identity.legacyBackendBridge !== false
  )
    throw new Error("PRODUCTION_RECOVERY_RELEASE_MISMATCH");
  const subscription = await getCalendarSubscriptionById(
    scope.subscription,
    env,
  );
  if (
    !subscription ||
    subscription.status !== "active" ||
    subscription.provider !== "google_api" ||
    subscription.revoked_at ||
    !subscription.external_calendar_id ||
    subscription.anonymous_session_id !== scope.owner ||
    subscription.timetable_id !== scope.timetable ||
    Number(subscription.google_connection_generation ?? 0) !==
      scope.connectionGeneration
  )
    throw new Error("PRODUCTION_RECOVERY_CONNECTION_MISMATCH");

  const preview = await withExternalRequestBudget(40, () =>
    previewGoogleSubscriptionSync(scope.subscription, env),
  );
  const summary = (p) => ({
    revision: p.publishedRevision,
    connectionGeneration: p.connectionGeneration,
    expectedEvents: p.expectedEvents,
    creates: p.wouldCreate,
    updates: p.wouldUpdate,
    deletes: p.wouldDelete,
    ownershipReview: p.ownershipReviewCount,
    remoteContentsVerified: p.remoteContentsVerified,
    manifestHash: p.manifestHash,
    createKeys: p.createKeys,
    updateKeys: p.updateKeys,
  });
  if (mode === "preview") return { readOnly: true, ...summary(preview) };
  if (
    preview.manifestHash !== scope.manifestHash ||
    preview.publishedRevision !== scope.revision ||
    preview.connectionGeneration !== scope.connectionGeneration ||
    !preview.remoteReadComplete ||
    preview.ownershipReviewCount ||
    preview.wouldDelete ||
    preview.wouldCreate !== preview.wouldCreateExaminations ||
    preview.createKeys?.some((key) => !scope.createKeys.includes(key)) ||
    preview.updateKeys?.some(
      (key) => ![...scope.updateKeys, ...scope.createKeys].includes(key),
    ) ||
    preview.wouldCreate > scope.maxCreates
  )
    throw new Error("PRODUCTION_RECOVERY_MANIFEST_CHANGED");

  const client = createSupabaseAdminClient(env);
  const current = await client
    .from("google_calendar_delivery_jobs")
    .select("desired_revision,requested_generation,reconnect_required_at")
    .eq("subscription_id", scope.subscription)
    .maybeSingle();
  if (
    current.error ||
    !current.data ||
    current.data.reconnect_required_at ||
    Number(current.data.desired_revision) !== scope.deliveryRevision ||
    Number(current.data.requested_generation) !== scope.deliveryGeneration
  )
    throw new Error("PRODUCTION_RECOVERY_JOB_UNAVAILABLE");
  for (let attempt = 0; attempt < 8; attempt++) {
    const job = await claimGoogleCalendarSubscriptionDelivery(
      scope.subscription,
      300,
      env,
    );
    if (!job) {
      if (preview.remoteContentsVerified && preview.wouldUpdate === 0)
        return {
          readOnly: false,
          remotelyVerified: true,
          alreadyConverged: true,
        };
      throw new Error("PRODUCTION_RECOVERY_JOB_NOT_CLAIMED");
    }
    let verified = false;
    let continuation = false;
    const finished = await deliverGoogleCalendarJob(
      job,
      async (_claimed, signal) => {
        if (job.revision !== Number(current.data.desired_revision))
          throw new Error("PRODUCTION_RECOVERY_JOB_CHANGED");
        try {
          await syncGoogleSubscription(scope.subscription, env, {
            signal,
            maxExternalRequests: 40,
          });
        } catch (error) {
          continuation = error?.code === "GOOGLE_SYNC_CONTINUE";
          throw error;
        }
        const after = await withExternalRequestBudget(40, () =>
          previewGoogleSubscriptionSync(scope.subscription, env),
        );
        verified = Boolean(
          googleProductionRecoveryScope(env) &&
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
      throw new Error("PRODUCTION_RECOVERY_NOT_CONVERGED");
    // The durable continuation contract schedules the next claim 15 seconds later.
    await delay(16_000);
    if (!googleProductionRecoveryScope(env))
      throw new Error("PRODUCTION_RECOVERY_SCOPE_EXPIRED");
  }
  throw new Error("PRODUCTION_RECOVERY_CONTINUATION_REQUIRED");
}

if (process.argv[1]?.endsWith("recover-production-google.mjs")) {
  try {
    console.log(
      JSON.stringify(
        await runProductionGoogleRecovery(
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
      /^(GOOGLE|PRODUCTION_RECOVERY)_[A-Z_]{1,90}$/.test(code ?? "")
        ? code
        : "PRODUCTION_RECOVERY_FAILED",
    );
    process.exitCode = 1;
  }
}
