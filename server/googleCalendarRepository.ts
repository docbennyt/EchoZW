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
  anonymousSessionId: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const { data, error } = await client(input.env).rpc(
    "start_google_calendar_connection",
    {
      p_state_hash: input.stateHash,
      p_subscription_id: input.subscriptionId,
      p_expires_at: input.expiresAt,
      p_owner: input.anonymousSessionId,
    },
  );
  if (error)
    throw databaseError("Could not start Google Calendar connection.", error);
  if (data !== true)
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
}

export async function consumeGoogleOAuthState(input: {
  stateHash: string;
  env?: NodeJS.ProcessEnv;
}) {
  const db = client(input.env);
  const { data, error } = await db
    .from("google_calendar_oauth_states")
    .delete()
    .eq("state_hash", input.stateHash)
    .select(
      "state_hash, subscription_id, expires_at, connection_generation, anonymous_session_id",
    )
    .maybeSingle();
  if (error)
    throw databaseError("Could not verify Google Calendar connection.", error);
  return (data ?? null) as JsonRecord | null;
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

export async function persistGoogleCalendarConnection(input: {
  subscriptionId: string;
  connectionGeneration: number;
  encryptedRefreshToken: string;
  grantedScope: string;
  env?: NodeJS.ProcessEnv;
}) {
  const { data, error } = await client(input.env).rpc(
    "complete_google_calendar_connection",
    {
      p_subscription_id: input.subscriptionId,
      p_generation: input.connectionGeneration,
      p_encrypted_refresh_token: input.encryptedRefreshToken,
      p_granted_scope: input.grantedScope,
    },
  );
  if (error)
    throw databaseError(
      "Could not securely save Google Calendar access.",
      error,
    );
  if (data !== true)
    throw new PilotApiError(
      "SUBSCRIPTION_DISCONNECTED",
      "This Google Calendar connection changed. Please start again.",
      409,
    );
}

export async function disconnectGoogleCalendarConnection(input: {
  subscriptionId: string;
  anonymousSessionId: string | null;
  deleteCreatedCalendar: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const { data, error } = await client(input.env).rpc(
    "disconnect_google_calendar_connection",
    {
      p_subscription_id: input.subscriptionId,
      p_owner: input.anonymousSessionId,
      p_delete_calendar: input.deleteCreatedCalendar,
    },
  );
  if (error)
    throw databaseError("Could not disconnect Google Calendar.", error);
  if (!data)
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  return data as JsonRecord;
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

export async function listSyncableGoogleSubscriptions(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("calendar_subscriptions")
    .select("*")
    .eq("timetable_id", timetableId)
    .eq("provider", "google_api")
    .in("status", ["active", "failed"])
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
  connectionGeneration?: number;
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

  let query = client(input.env)
    .from("calendar_subscriptions")
    .update(patch)
    .eq("id", input.subscriptionId);
  if (input.connectionGeneration !== undefined) {
    query = query
      .eq("google_connection_generation", input.connectionGeneration)
      .is("revoked_at", null);
    query = query.neq("status", "disconnected");
  }
  const { data, error } = await query.select("id").maybeSingle();
  if (error)
    throw databaseError(
      "Could not update Google Calendar subscription.",
      error,
    );
  return Boolean(data);
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
  connectionGeneration?: number;
}) {
  const now = new Date().toISOString();
  if (input.connectionGeneration !== undefined) {
    const { data, error } = await client(input.env).rpc(
      "write_google_calendar_sync_record",
      {
        p_subscription_id: input.subscriptionId,
        p_generation: input.connectionGeneration,
        p_internal_event_id: input.internalEventId,
        p_record: {
          timetable_version_id: input.timetableVersionId,
          external_calendar_id: input.externalCalendarId,
          external_event_id: input.externalEventId,
          content_hash: input.contentHash,
          sync_status: input.syncStatus,
          last_error_code: input.lastErrorCode ?? null,
        },
      },
    );
    if (error)
      throw databaseError("Could not save Google Calendar event state.", error);
    if (data !== true)
      throw new PilotApiError(
        "GOOGLE_CONNECTION_CHANGED",
        "Google Calendar connection changed during synchronization.",
        409,
      );
    return;
  }
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
  connectionGeneration?: number;
}) {
  if (input.connectionGeneration !== undefined) {
    const { data, error } = await client(input.env).rpc(
      "write_google_calendar_sync_record",
      {
        p_subscription_id: input.subscriptionId,
        p_generation: input.connectionGeneration,
        p_internal_event_id: input.internalEventId,
        p_record: null,
      },
    );
    if (error)
      throw databaseError(
        "Could not remove Google Calendar event state.",
        error,
      );
    if (data !== true)
      throw new PilotApiError(
        "GOOGLE_CONNECTION_CHANGED",
        "Google Calendar connection changed during synchronization.",
        409,
      );
    return;
  }
  const { error } = await client(input.env)
    .from("calendar_event_sync_records")
    .delete()
    .eq("subscription_id", input.subscriptionId)
    .eq("provider", "google_api")
    .eq("internal_event_id", input.internalEventId);
  if (error)
    throw databaseError("Could not remove Google Calendar event state.", error);
}
