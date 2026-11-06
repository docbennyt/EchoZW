import { isAnalyticsUuid } from "../src/domain/analytics.js";
import { googleSubscriptionAllowed } from "./googleDeliveryPolicy.js";
import { PilotApiError } from "./pilotRepository.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export type GoogleConnectionStatus = {
  subscriptionId: string;
  state:
    | "pending"
    | "syncing"
    | "synced"
    | "reconnect_required"
    | "failed"
    | "disconnected";
  lastSyncedAt: string | null;
  reconnectAllowed: boolean;
};

export async function getOwnedGoogleConnection(
  timetableId: string,
  owner: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GoogleConnectionStatus | null> {
  if (!isAnalyticsUuid(owner)) return null;
  const db = createSupabaseAdminClient(env);
  const { data: row, error } = await db
    .from("calendar_subscriptions")
    .select(
      "id, provider, timetable_id, anonymous_session_id, status, revoked_at, last_synced_at, last_error_code, google_connection_generation",
    )
    .eq("timetable_id", timetableId)
    .eq("anonymous_session_id", owner)
    .eq("provider", "google_api")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not check your calendar connection.",
      503,
    );
  if (!row) return null;
  const { data: job, error: jobError } = await db
    .from("google_calendar_delivery_jobs")
    .select(
      "desired_revision, successful_revision, requested_generation, successful_generation, reconnect_required_at",
    )
    .eq("subscription_id", row.id)
    .maybeSingle();
  if (jobError)
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not check calendar delivery.",
      503,
    );
  const reconnect =
    Boolean(job?.reconnect_required_at) ||
    [
      "GOOGLE_CREDENTIAL_INVALID",
      "GOOGLE_NOT_CONNECTED",
      "GOOGLE_REFRESH_TOKEN_MISSING",
    ].includes(String(row.last_error_code));
  let state: GoogleConnectionStatus["state"] = "syncing";
  if (row.status === "disconnected") state = "disconnected";
  else if (reconnect) state = "reconnect_required";
  else if (row.status === "failed") state = "failed";
  else if (row.status === "pending") state = "pending";
  else if (
    row.status === "active" &&
    row.last_synced_at &&
    job &&
    Number(job.successful_revision) >= Number(job.desired_revision) &&
    Number(job.successful_generation) >= Number(job.requested_generation)
  )
    state = "synced";
  return {
    subscriptionId: String(row.id),
    state,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    reconnectAllowed: googleSubscriptionAllowed(env, row),
  };
}
