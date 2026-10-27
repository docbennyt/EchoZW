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
  const scope = googleCanaryScope(env);
  return Boolean(
    scope?.subscription &&
    row.id === scope.subscription &&
    row.anonymous_session_id === scope.owner &&
    row.timetable_id === scope.timetable &&
    row.provider === "google_api" &&
    !row.revoked_at &&
    row.status !== "disconnected",
  );
}

export function googleDeliveryTargetAllowed(env: Bindings, id: unknown) {
  if (env.ENABLE_GOOGLE_DELIVERY === "true") return true;
  const scope = googleCanaryScope(env);
  return Boolean(scope?.subscription && id === scope.subscription);
}
