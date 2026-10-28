type Bindings = Record<string, unknown>;
type Subscription = Record<string, unknown>;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Enrollment can prepare a pending record; OAuth needs its separately selected ID.
 * Bindings are operator-controlled and never supplied by an HTTP caller.
 */
export function googleCanaryScope(env: Bindings) {
  const owner = env.GOOGLE_CANARY_OWNER_ID;
  const timetable = env.GOOGLE_CANARY_TIMETABLE_ID;
  const subscription = env.GOOGLE_CANARY_SUBSCRIPTION_ID;
  const expires = Date.parse(String(env.GOOGLE_CANARY_EXPIRES_AT ?? ""));
  const remaining = expires - Date.now();
  if (
    env.APP_ENV !== "cloudflare-staging" ||
    !uuid(owner) ||
    !uuid(timetable) ||
    (subscription !== undefined && !uuid(subscription)) ||
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 86400000
  )
    return null;
  return { owner, timetable, subscription, expires };
}

/**
 * Explicit one-subscription recovery for already-connected accounts.
 * Staging-only, release-pinned and short-lived; never enables enrollment or
 * removes the global production delivery gate.
 */
export function googleRecoveryScope(env: Bindings) {
  const raw = env.GOOGLE_RECOVERY_CANARY;
  if (
    env.APP_ENV !== "cloudflare-staging" ||
    env.ENABLE_GOOGLE_DELIVERY === "true" ||
    typeof raw !== "string" ||
    raw.length > 1024
  )
    return null;
  try {
    const scope = JSON.parse(raw);
    const keys = [
      "candidateSha",
      "ownerId",
      "timetableId",
      "subscriptionId",
      "expiresAt",
      "mode",
      "revision",
      "connectionGeneration",
      "maxCreates",
      "maxDeletes",
    ];
    if (
      !scope ||
      Array.isArray(scope) ||
      typeof scope !== "object" ||
      Object.keys(scope).length !== keys.length ||
      Object.keys(scope).some((key) => !keys.includes(key))
    )
      return null;
    const expires = Date.parse(scope.expiresAt);
    const remaining = expires - Date.now();
    if (
      scope.mode !== "deliver" ||
      !Number.isSafeInteger(scope.revision) ||
      scope.revision < 1 ||
      scope.revision > 2147483647 ||
      !Number.isSafeInteger(scope.connectionGeneration) ||
      scope.connectionGeneration < 0 ||
      scope.maxCreates !== 0 ||
      scope.maxDeletes !== 0 ||
      typeof scope.candidateSha !== "string" ||
      !/^[a-f0-9]{40}$/.test(scope.candidateSha) ||
      scope.candidateSha !== env.SOURCE_SHA ||
      !uuid(scope.ownerId) ||
      !uuid(scope.timetableId) ||
      !uuid(scope.subscriptionId) ||
      typeof scope.expiresAt !== "string" ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 86400000
    )
      return null;
    return {
      owner: scope.ownerId as string,
      timetable: scope.timetableId as string,
      subscription: scope.subscriptionId as string,
      expires,
      revision: scope.revision as number,
      connectionGeneration: scope.connectionGeneration as number,
      maxCreates: 0,
      maxDeletes: 0,
    };
  } catch {
    return null;
  }
}

export function googleEnrollmentAllowed(
  env: Bindings,
  owner: unknown,
  timetable: unknown,
) {
  if (env.ENABLE_GOOGLE_DELIVERY === "true") return true;
  const scope = googleCanaryScope(env);
  return Boolean(
    scope && owner === scope.owner && timetable === scope.timetable,
  );
}

export function googleSubscriptionAllowed(env: Bindings, row: Subscription) {
  if (env.ENABLE_GOOGLE_DELIVERY === "true") return true;
  const qa = googleCanaryScope(env);
  const recovery = googleRecoveryScope(env);
  const matches = (scope: ReturnType<typeof googleCanaryScope>) =>
    scope !== null &&
    scope.subscription === row.id &&
    scope.owner === row.anonymous_session_id &&
    scope.timetable === row.timetable_id;
  return Boolean(
    (matches(qa) ||
      (matches(recovery) &&
        row.status === "active" &&
        Number(row.google_connection_generation ?? 0) ===
          recovery?.connectionGeneration)) &&
    row.provider === "google_api" &&
    !row.revoked_at &&
    row.status !== "disconnected",
  );
}

export function googleDeliveryTargetAllowed(env: Bindings, id: unknown) {
  if (env.ENABLE_GOOGLE_DELIVERY === "true") return true;
  const target =
    googleRecoveryScope(env)?.subscription ??
    googleCanaryScope(env)?.subscription;
  return Boolean(target && target === id);
}
