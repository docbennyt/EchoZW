import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export class PushNotificationRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly causeDetail?: unknown,
  ) {
    super(message);
    this.name = "PushNotificationRepositoryError";
  }
}

export type PushPlatform = "android" | "ios" | "desktop" | "unknown";

export type ClaimedPushOutbox = {
  id: string;
  timetableId: string;
  publicSlug: string;
  sourceKind: string;
  sourceId: string;
  changeKind: string;
  changeCount: number;
  payload: Record<string, unknown>;
  attemptCount: number;
};

export type ClaimedPushDelivery = {
  deliveryId: string;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
  platform: PushPlatform;
  attemptCount: number;
};

function client(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

function endpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

function databaseError(
  message: string,
  error: SupabaseErrorLike,
): PushNotificationRepositoryError {
  return new PushNotificationRepositoryError(
    "PUSH_DATABASE_UNAVAILABLE",
    503,
    message,
    error,
  );
}

async function resolveTimetableId(
  publicSlug: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env)
    .from("timetables")
    .select("id")
    .eq("public_slug", publicSlug)
    .is("archived_at", null)
    .maybeSingle();
  if (error)
    throw databaseError("Could not resolve timetable for push alerts.", error);
  return data?.id ? String(data.id) : null;
}

export async function getPushSubscriptionStatus(
  input: { publicSlug: string; endpoint: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const timetableId = await resolveTimetableId(input.publicSlug, env);
  if (!timetableId) return { foundTimetable: false, active: false } as const;

  const { data, error } = await client(env)
    .from("push_subscriptions")
    .select("status")
    .eq("timetable_id", timetableId)
    .eq("endpoint_hash", endpointHash(input.endpoint))
    .maybeSingle();
  if (error)
    throw databaseError("Could not read push subscription status.", error);
  return {
    foundTimetable: true,
    active: data?.status === "active",
  } as const;
}

export async function upsertPushSubscription(
  input: {
    publicSlug: string;
    endpoint: string;
    p256dh: string;
    authSecret: string;
    platform: PushPlatform;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const timetableId = await resolveTimetableId(input.publicSlug, env);
  if (!timetableId) {
    throw new PushNotificationRepositoryError(
      "TIMETABLE_NOT_FOUND",
      404,
      "Published timetable not found.",
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await client(env)
    .from("push_subscriptions")
    .upsert(
      {
        timetable_id: timetableId,
        endpoint: input.endpoint,
        endpoint_hash: endpointHash(input.endpoint),
        p256dh: input.p256dh,
        auth_secret: input.authSecret,
        platform: input.platform,
        status: "active",
        revoked_at: null,
        last_error_at: null,
        last_error_code: null,
        updated_at: now,
      },
      { onConflict: "timetable_id,endpoint_hash" },
    )
    .select("id")
    .single();
  if (error) throw databaseError("Could not save push subscription.", error);
  return { id: String(data.id), timetableId };
}

export async function revokePushSubscription(
  input: { publicSlug: string; endpoint: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const timetableId = await resolveTimetableId(input.publicSlug, env);
  if (!timetableId) return { foundTimetable: false, revoked: false } as const;

  const now = new Date().toISOString();
  const { data, error } = await client(env)
    .from("push_subscriptions")
    .update({
      status: "revoked",
      revoked_at: now,
      updated_at: now,
    })
    .eq("timetable_id", timetableId)
    .eq("endpoint_hash", endpointHash(input.endpoint))
    .eq("status", "active")
    .select("id");
  if (error) throw databaseError("Could not disable push subscription.", error);
  return {
    foundTimetable: true,
    revoked: Array.isArray(data) && data.length > 0,
  } as const;
}

export async function claimPushOutbox(
  limit = 10,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaimedPushOutbox[]> {
  const { data, error } = await client(env).rpc(
    "claim_push_notification_outbox",
    {
      p_limit: limit,
    },
  );
  if (error) throw databaseError("Could not claim push outbox work.", error);
  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: String(row.id),
    timetableId: String(row.timetable_id),
    publicSlug: String(row.public_slug),
    sourceKind: String(row.source_kind),
    sourceId: String(row.source_id),
    changeKind: String(row.change_kind),
    changeCount: Number(row.change_count ?? 1),
    payload:
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    attemptCount: Number(row.attempt_count ?? 0),
  }));
}

export async function claimPushDeliveries(
  outboxId: string,
  limit = 100,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaimedPushDelivery[]> {
  const { data, error } = await client(env).rpc(
    "claim_push_notification_deliveries",
    { p_outbox_id: outboxId, p_limit: limit },
  );
  if (error)
    throw databaseError("Could not claim push delivery targets.", error);
  return ((data ?? []) as JsonRecord[]).map((row) => ({
    deliveryId: String(row.delivery_id),
    subscriptionId: String(row.subscription_id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    authSecret: String(row.auth_secret),
    platform: String(row.platform ?? "unknown") as PushPlatform,
    attemptCount: Number(row.attempt_count ?? 0),
  }));
}

export async function recordPushDelivery(
  input: {
    deliveryId: string;
    result: "delivered" | "retry" | "terminal";
    errorCode?: string | null;
    retryAfterSeconds?: number | null;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env).rpc(
    "record_push_notification_delivery",
    {
      p_delivery_id: input.deliveryId,
      p_result: input.result,
      p_error_code: input.errorCode ?? null,
      p_retry_after_seconds: input.retryAfterSeconds ?? null,
    },
  );
  if (error)
    throw databaseError("Could not record push delivery result.", error);
  return String(data ?? "");
}

export async function finalizePushOutbox(
  outboxId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env).rpc(
    "finalize_push_notification_outbox",
    { p_outbox_id: outboxId },
  );
  if (error) throw databaseError("Could not finalize push outbox item.", error);
  return String(data ?? "");
}
