import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { getCalendarSubscriptionById } from "./pilotRepository.js";
import { googleSubscriptionAllowed } from "./googleDeliveryPolicy.js";

/** Recover one authorized canary without scanning/enqueuing student subscriptions.
 * The Queue claim still owns due-time, lease and reconnect fencing.
 */
export async function recoverGoogleCalendarSubscriptionDelivery(
  subscriptionId: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const raw: unknown = await getCalendarSubscriptionById(subscriptionId, env);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const subscription = raw as Record<string, unknown>;
  if (!googleSubscriptionAllowed(env, subscription)) return false;
  if (!["active", "failed", "pending"].includes(String(subscription.status)))
    return false;
  const client = createSupabaseAdminClient(env);
  // Select only presence, never credential material.
  const credential = await client
    .from("google_calendar_credentials")
    .select("subscription_id")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  if (credential.error) throw new Error("GOOGLE_CANARY_RECOVERY_UNAVAILABLE");
  if (!credential.data) return false;
  const revision = await client
    .from("google_calendar_delivery_revisions")
    .select("revision")
    .eq("timetable_id", String(subscription.timetable_id))
    .maybeSingle();
  const job = await client
    .from("google_calendar_delivery_jobs")
    .select(
      "desired_revision,successful_revision,requested_generation,successful_generation,available_at,reconnect_required_at",
    )
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  if (revision.error || job.error || !revision.data)
    throw new Error("GOOGLE_CANARY_RECOVERY_UNAVAILABLE");
  const desired = BigInt(String(revision.data.revision));
  if (!job.data || BigInt(String(job.data.desired_revision)) < desired) {
    return enqueueSubscriptionReconciliation(subscriptionId, env);
  }
  const row = job.data;
  return (
    !row.reconnect_required_at &&
    Date.parse(String(row.available_at)) <= Date.now() &&
    (BigInt(String(row.successful_revision)) < desired ||
      BigInt(String(row.successful_generation)) <
        BigInt(String(row.requested_generation)))
  );
}

export type GoogleCalendarDeliveryJob = {
  subscriptionId: string;
  revision: number;
  leaseToken: string;
  attemptCount: number;
  leaseExpiresAt: string;
};

export type GoogleCalendarDeliveryOutcome =
  "success" | "retry" | "reconnect" | "continue";

async function rpc(
  name: string,
  args: Record<string, unknown>,
  env?: NodeJS.ProcessEnv,
) {
  const { data, error } = await createSupabaseAdminClient(env).rpc(name, args);
  if (error)
    throw new Error(`Google delivery database operation failed: ${name}`);
  return data;
}

export async function recoverGoogleCalendarDelivery(
  limit = 100,
  env?: NodeJS.ProcessEnv,
): Promise<number> {
  return Number(
    await rpc("recover_google_calendar_delivery", { p_limit: limit }, env),
  );
}

export async function enqueueSubscriptionReconciliation(
  subscriptionId: string,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  return Boolean(
    await rpc(
      "enqueue_google_calendar_subscription",
      { p_subscription_id: subscriptionId },
      env,
    ),
  );
}

export async function listReadyGoogleCalendarDeliveries(
  limit = 10,
  env?: NodeJS.ProcessEnv,
): Promise<string[]> {
  const rows = await rpc(
    "list_google_calendar_delivery_ready",
    { p_limit: limit },
    env,
  );
  return (rows ?? []).map((row: Record<string, unknown>) =>
    String(row.subscription_id),
  );
}

export async function claimGoogleCalendarSubscriptionDelivery(
  subscriptionId: string,
  leaseSeconds = 300,
  env?: NodeJS.ProcessEnv,
): Promise<GoogleCalendarDeliveryJob | null> {
  const rows = await rpc(
    "claim_google_calendar_delivery",
    {
      p_limit: 1,
      p_lease_seconds: leaseSeconds,
      p_subscription_id: subscriptionId,
    },
    env,
  );
  return mapJobs(rows)[0] ?? null;
}

export async function claimGoogleCalendarDelivery(
  limit = 10,
  leaseSeconds = 300,
  env?: NodeJS.ProcessEnv,
): Promise<GoogleCalendarDeliveryJob[]> {
  const rows = await rpc(
    "claim_google_calendar_delivery",
    { p_limit: limit, p_lease_seconds: leaseSeconds },
    env,
  );
  return mapJobs(rows);
}

function mapJobs(
  rows: Record<string, unknown>[] | null,
): GoogleCalendarDeliveryJob[] {
  return (rows ?? []).map((row) => ({
    subscriptionId: String(row.subscription_id),
    revision: Number(row.claimed_revision),
    leaseToken: String(row.lease_token),
    attemptCount: Number(row.attempt_count),
    leaseExpiresAt: String(row.lease_expires_at),
  }));
}

export async function finishGoogleCalendarDelivery(
  job: GoogleCalendarDeliveryJob,
  outcome: GoogleCalendarDeliveryOutcome,
  errorCode: string | null,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  return Boolean(
    await rpc(
      "finish_google_calendar_delivery",
      {
        p_subscription_id: job.subscriptionId,
        p_lease_token: job.leaseToken,
        p_revision: job.revision,
        p_outcome: outcome,
        p_error_code: errorCode,
      },
      env,
    ),
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function classifyGoogleCalendarDeliveryError(
  error: unknown,
): "retry" | "reconnect" {
  const value = record(error);
  const details = record(value.details);
  const provider = record(details.error);
  // Legacy GOOGLE_REFRESH_FAILED loses the upstream status/body, including 429/5xx.
  // Only positive credential evidence may stop retries pending reconnection.
  if (
    ["GOOGLE_CREDENTIAL_INVALID", "GOOGLE_NOT_CONNECTED"].includes(
      String(value.code),
    ) ||
    details.error === "invalid_grant" ||
    provider.error === "invalid_grant" ||
    provider.status === "UNAUTHENTICATED" ||
    details.status === 401
  )
    return "reconnect";
  return "retry";
}

/** The adapter must honor signal and only return completed after all provider writes.
 * Queue messages are wakeups; claim in the consumer, never enqueue leased jobs.
 * Provider writes are at-least-once: database fencing cannot fence Google's API.
 */
export async function deliverGoogleCalendarJob(
  job: GoogleCalendarDeliveryJob,
  sync: (
    job: GoogleCalendarDeliveryJob,
    signal: AbortSignal,
  ) => Promise<{ completed: boolean }>,
  dependencies: {
    finish?: (
      job: GoogleCalendarDeliveryJob,
      outcome: GoogleCalendarDeliveryOutcome,
      errorCode: string | null,
    ) => Promise<boolean>;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<boolean> {
  const remaining = Date.parse(job.leaseExpiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 5_000) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining - 5_000);
  let outcome: GoogleCalendarDeliveryOutcome = "success";
  let code: string | null = null;
  try {
    const result = await sync(job, controller.signal);
    if (!result.completed || controller.signal.aborted) {
      outcome = "retry";
      code = "GOOGLE_SYNC_INCOMPLETE";
    }
  } catch (error) {
    outcome =
      record(error).code === "GOOGLE_SYNC_CONTINUE"
        ? "continue"
        : classifyGoogleCalendarDeliveryError(error);
    const candidate = String(record(error).code ?? "");
    code = /^GOOGLE_[A-Z_]{1,100}$/.test(candidate)
      ? candidate
      : "GOOGLE_DELIVERY_FAILED";
  } finally {
    clearTimeout(timer);
  }
  // A failed acknowledgment must escape; expiry recovers the still-owned job.
  const finish =
    dependencies.finish ??
    ((claimed, result, errorCode) =>
      finishGoogleCalendarDelivery(
        claimed,
        result,
        errorCode,
        dependencies.env,
      ));
  return finish(job, outcome, code);
}
