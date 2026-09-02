import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { PilotApiError } from "./pilotRepository.js";

type JsonRecord = Record<string, unknown>;

function client(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

function databaseError(message: string, details?: unknown) {
  return new PilotApiError("DATABASE_UNAVAILABLE", message, 503, details);
}

export async function createGoogleOAuthState(input: {
  stateHash: string;
  subscriptionId: string;
  expiresAt: string;
  env?: NodeJS.ProcessEnv;
}) {
  const { error } = await client(input.env)
    .from("google_calendar_oauth_states")
    .insert({
      state_hash: input.stateHash,
      subscription_id: input.subscriptionId,
      expires_at: input.expiresAt,
    });
  if (error)
    throw databaseError("Could not start Google Calendar connection.", error);
}

export async function consumeGoogleOAuthState(input: {
  stateHash: string;
  env?: NodeJS.ProcessEnv;
}) {
  const db = client(input.env);
  const { data, error } = await db
    .from("google_calendar_oauth_states")
    .select("state_hash, subscription_id, expires_at")
    .eq("state_hash", input.stateHash)
    .maybeSingle();
  if (error)
    throw databaseError("Could not verify Google Calendar connection.", error);
  if (!data) return null;

  const { error: deleteError } = await db
    .from("google_calendar_oauth_states")
    .delete()
    .eq("state_hash", input.stateHash);
  if (deleteError) {
    throw databaseError(
      "Could not complete Google Calendar connection.",
      deleteError,
    );
  }

  return data as JsonRecord;
}

export async function saveGoogleCredential(input: {
  subscriptionId: string;
  encryptedRefreshToken: string;
  grantedScope: string;
  env?: NodeJS.ProcessEnv;
}) {
  const now = new Date().toISOString();
  const { error } = await client(input.env)
    .from("google_calendar_credentials")
    .upsert(
      {
        subscription_id: input.subscriptionId,
        encrypted_refresh_token: input.encryptedRefreshToken,
        granted_scope: input.grantedScope,
        updated_at: now,
      },
      { onConflict: "subscription_id" },
    );
  if (error)
    throw databaseError(
      "Could not securely save Google Calendar access.",
      error,
    );
}

export async function getGoogleCredential(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("google_calendar_credentials")
    .select("subscription_id, encrypted_refresh_token, granted_scope")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();
  if (error)
    throw databaseError("Could not load Google Calendar access.", error);
  return (data ?? null) as JsonRecord | null;
}

export async function deleteGoogleCredential(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { error } = await client(env)
    .from("google_calendar_credentials")
    .delete()
    .eq("subscription_id", subscriptionId);
  if (error)
    throw databaseError("Could not remove Google Calendar access.", error);
}

export async function listActiveGoogleSubscriptions(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("calendar_subscriptions")
    .select("*")
    .eq("timetable_id", timetableId)
    .eq("provider", "google_api")
    .eq("status", "active")
    .is("revoked_at", null);
  if (error)
    throw databaseError("Could not load Google Calendar subscriptions.", error);
  return (data ?? []) as JsonRecord[];
}

export async function updateGoogleSubscription(input: {
  subscriptionId: string;
  status?: "pending" | "active" | "disconnected" | "failed";
  externalCalendarId?: string | null;
  syncedTimetableVersionId?: string | null;
  lastSyncedAt?: string | null;
  lastErrorCode?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const patch: JsonRecord = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.externalCalendarId !== undefined) {
    patch.external_calendar_id = input.externalCalendarId;
  }
  if (input.syncedTimetableVersionId !== undefined) {
    patch.synced_timetable_version_id = input.syncedTimetableVersionId;
  }
  if (input.lastSyncedAt !== undefined)
    patch.last_synced_at = input.lastSyncedAt;
  if (input.lastErrorCode !== undefined)
    patch.last_error_code = input.lastErrorCode;

  const { error } = await client(input.env)
    .from("calendar_subscriptions")
    .update(patch)
    .eq("id", input.subscriptionId);
  if (error)
    throw databaseError(
      "Could not update Google Calendar subscription.",
      error,
    );
}

export async function getCurrentPublishedVersionId(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("timetables")
    .select("current_published_version_id")
    .eq("id", timetableId)
    .maybeSingle();
  if (error)
    throw databaseError("Could not load published timetable version.", error);
  const value = (data as JsonRecord | null)?.current_published_version_id;
  return value ? String(value) : null;
}

export async function listGoogleEventSyncRecords(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("calendar_event_sync_records")
    .select("*")
    .eq("subscription_id", subscriptionId)
    .eq("provider", "google_api");
  if (error)
    throw databaseError("Could not load Google Calendar event state.", error);
  return (data ?? []) as JsonRecord[];
}

export async function upsertGoogleEventSyncRecord(input: {
  subscriptionId: string;
  internalEventId: string;
  timetableVersionId: string;
  externalCalendarId: string;
  externalEventId: string;
  contentHash: string;
  syncStatus: "active" | "failed";
  lastErrorCode?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const now = new Date().toISOString();
  const { error } = await client(input.env)
    .from("calendar_event_sync_records")
    .upsert(
      {
        subscription_id: input.subscriptionId,
        internal_event_id: input.internalEventId,
        timetable_version_id: input.timetableVersionId,
        provider: "google_api",
        external_calendar_id: input.externalCalendarId,
        external_event_id: input.externalEventId,
        content_hash: input.contentHash,
        sync_status: input.syncStatus,
        last_synced_at: input.syncStatus === "active" ? now : null,
        last_error_code: input.lastErrorCode ?? null,
        updated_at: now,
      },
      { onConflict: "subscription_id,provider,internal_event_id" },
    );
  if (error)
    throw databaseError("Could not save Google Calendar event state.", error);
}

export async function deleteGoogleEventSyncRecord(input: {
  subscriptionId: string;
  internalEventId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const { error } = await client(input.env)
    .from("calendar_event_sync_records")
    .delete()
    .eq("subscription_id", input.subscriptionId)
    .eq("provider", "google_api")
    .eq("internal_event_id", input.internalEventId);
  if (error)
    throw databaseError("Could not remove Google Calendar event state.", error);
}
