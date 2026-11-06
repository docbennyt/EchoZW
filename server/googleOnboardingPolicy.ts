import { createHash } from "node:crypto";
import { z } from "zod";

type Bindings = Record<string, unknown>;
type Subscription = Record<string, unknown>;
const uuid = z.string().uuid();
const revision = z.number().int().min(1).max(2147483647);
const schema = z
  .object({
    mode: z.enum(["new", "reconnect"]),
    phase: z.enum(["enroll", "connect", "deliver"]),
    candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
    ownerId: uuid,
    timetableId: uuid,
    subscriptionId: uuid.nullable(),
    issuedAt: z.string(),
    expiresAt: z.string(),
    revision,
    connectionGeneration: z.number().int().min(0).max(2147483647),
    calendarIdHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    deliveryRevision: revision.nullable(),
    deliveryGeneration: revision.nullable(),
    maxCreates: z.number().int().min(0).max(32),
    maxUpdates: z.number().int().min(0).max(32),
    maxDeletes: z.literal(0),
  })
  .strict();

/** A protected production binding. HTTP callers never supply this scope. */
export function googleOnboardingScope(env: Bindings) {
  if (
    env.APP_ENV !== "cloudflare-production" ||
    env.ENABLE_GOOGLE_DELIVERY !== "false"
  )
    return null;
  const raw = env.GOOGLE_PRODUCTION_ONBOARDING;
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const s = schema.parse(JSON.parse(raw));
    const issued = Date.parse(s.issuedAt),
      expires = Date.parse(s.expiresAt),
      now = Date.now();
    if (
      s.candidateSha !== env.SOURCE_SHA ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > now ||
      expires <= now ||
      expires - issued > 86400000 ||
      s.maxCreates + s.maxUpdates > 32
    )
      return null;
    if (
      s.mode === "new"
        ? s.connectionGeneration !== 0 || s.calendarIdHash !== null
        : s.phase === "enroll" ||
          s.subscriptionId === null ||
          s.calendarIdHash === null
    )
      return null;
    if (
      s.phase === "enroll"
        ? s.subscriptionId !== null
        : s.subscriptionId === null
    )
      return null;
    if (
      s.phase === "deliver"
        ? s.deliveryRevision === null || s.deliveryGeneration === null
        : s.deliveryRevision !== null || s.deliveryGeneration !== null
    )
      return null;
    return {
      ...s,
      owner: s.ownerId,
      timetable: s.timetableId,
      subscription: s.subscriptionId,
      issued,
      expires,
      maxExternalRequests: 40,
    };
  } catch {
    return null;
  }
}

export function googleOnboardingEnrollmentAllowed(
  env: Bindings,
  owner: unknown,
  timetable: unknown,
) {
  const scope = googleOnboardingScope(env);
  return Boolean(
    scope?.phase === "enroll" &&
    scope.mode === "new" &&
    scope.owner === owner &&
    scope.timetable === timetable,
  );
}

function matches(
  scope: NonNullable<ReturnType<typeof googleOnboardingScope>>,
  row: Subscription,
) {
  if (
    scope.subscription === null ||
    scope.subscription !== row.id ||
    scope.owner !== row.anonymous_session_id ||
    scope.timetable !== row.timetable_id ||
    row.provider !== "google_api" ||
    row.revoked_at ||
    Number(row.google_connection_generation) !== scope.connectionGeneration
  )
    return false;
  if (scope.mode === "new") {
    const created = Date.parse(String(row.created_at));
    return (
      Number.isFinite(created) &&
      created >= scope.issued &&
      created <= Date.now()
    );
  }
  return (
    typeof row.external_calendar_id === "string" &&
    createHash("sha256").update(row.external_calendar_id).digest("hex") ===
      scope.calendarIdHash
  );
}

export function googleOnboardingConnectionAllowed(
  env: Bindings,
  row: Subscription,
) {
  const scope = googleOnboardingScope(env);
  if (!scope || scope.phase !== "connect" || !matches(scope, row)) return false;
  return scope.mode === "new"
    ? row.status === "pending" && !row.external_calendar_id
    : ["active", "pending", "failed", "disconnected"].includes(
        String(row.status),
      );
}

export function googleOnboardingDeliveryCandidateAllowed(
  env: Bindings,
  row: Subscription,
) {
  const scope = googleOnboardingScope(env);
  return Boolean(
    scope &&
    scope.phase === "deliver" &&
    matches(scope, row) &&
    ["active", "pending", "failed"].includes(String(row.status)),
  );
}

export function googleOnboardingDeliveryAllowed(
  env: Bindings,
  row: Subscription,
  credentialUpdatedAt?: unknown,
) {
  const scope = googleOnboardingScope(env);
  if (!scope || !googleOnboardingDeliveryCandidateAllowed(env, row))
    return false;
  const updated = Date.parse(String(credentialUpdatedAt));
  return (
    Number.isFinite(updated) && updated >= scope.issued && updated <= Date.now()
  );
}
