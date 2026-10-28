// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  googleCanaryScope,
  googleRecoveryScope,
  googleDeliveryTargetAllowed,
  googleEnrollmentAllowed,
  googleSubscriptionAllowed,
} from "../server/googleDeliveryPolicy";

const owner = "11111111-1111-4111-8111-111111111111";
const timetable = "22222222-2222-4222-8222-222222222222";
const subscription = "33333333-3333-4333-8333-333333333333";
const config = () => ({
  APP_ENV: "cloudflare-staging",
  ENABLE_GOOGLE_DELIVERY: "false",
  GOOGLE_CANARY_OWNER_ID: owner,
  GOOGLE_CANARY_TIMETABLE_ID: timetable,
  GOOGLE_CANARY_SUBSCRIPTION_ID: subscription,
  GOOGLE_CANARY_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
});
const row = () => ({
  id: subscription,
  anonymous_session_id: owner,
  timetable_id: timetable,
  provider: "google_api",
  status: "pending",
});

describe("isolated staging Google delivery policy", () => {
  it("allows enrollment only for the configured owner and QA timetable", () => {
    expect(googleEnrollmentAllowed(config(), owner, timetable)).toBe(true);
    expect(googleEnrollmentAllowed(config(), subscription, timetable)).toBe(
      false,
    );
    expect(googleEnrollmentAllowed(config(), owner, subscription)).toBe(false);
  });
  it("requires the exact subscription, owner and timetable before provider work", () => {
    expect(googleSubscriptionAllowed(config(), row())).toBe(true);
    for (const field of [
      "id",
      "anonymous_session_id",
      "timetable_id",
      "provider",
    ]) {
      expect(
        googleSubscriptionAllowed(config(), { ...row(), [field]: "other" }),
      ).toBe(false);
    }
    expect(
      googleSubscriptionAllowed(config(), {
        ...row(),
        revoked_at: "2026-10-27",
      }),
    ).toBe(false);
    expect(
      googleSubscriptionAllowed(config(), { ...row(), status: "disconnected" }),
    ).toBe(false);
  });
  it("permits pending enrollment before selection but blocks OAuth and delivery", () => {
    const env = { ...config(), GOOGLE_CANARY_SUBSCRIPTION_ID: undefined };
    expect(googleEnrollmentAllowed(env, owner, timetable)).toBe(true);
    expect(googleSubscriptionAllowed(env, row())).toBe(false);
  });
  it.each([
    { APP_ENV: "production" },
    { GOOGLE_CANARY_OWNER_ID: "*" },
    { GOOGLE_CANARY_TIMETABLE_ID: undefined },
    { GOOGLE_CANARY_SUBSCRIPTION_ID: "id1,id2" },
    { GOOGLE_CANARY_EXPIRES_AT: "invalid" },
    { GOOGLE_CANARY_EXPIRES_AT: new Date(0).toISOString() },
    { GOOGLE_CANARY_EXPIRES_AT: "2099-01-01T00:00:00Z" },
  ])("fails closed on invalid or expired scope %#", (override) => {
    const env = { ...config(), ...override };
    expect(googleCanaryScope(env)).toBeNull();
    expect(googleEnrollmentAllowed(env, owner, timetable)).toBe(false);
    expect(googleSubscriptionAllowed(env, row())).toBe(false);
  });
  it("keeps the existing explicit global delivery policy", () => {
    expect(
      googleEnrollmentAllowed(
        { ENABLE_GOOGLE_DELIVERY: "true" },
        owner,
        timetable,
      ),
    ).toBe(true);
    expect(
      googleSubscriptionAllowed({ ENABLE_GOOGLE_DELIVERY: "true" }, row()),
    ).toBe(true);
    expect(googleEnrollmentAllowed({}, owner, timetable)).toBe(false);
    expect(googleSubscriptionAllowed({}, row())).toBe(false);
  });
});

const candidateSha = "a".repeat(40);
const recovery = () => ({
  APP_ENV: "cloudflare-staging",
  ENABLE_GOOGLE_DELIVERY: "false",
  SOURCE_SHA: candidateSha,
  GOOGLE_RECOVERY_CANARY: JSON.stringify({
    candidateSha,
    ownerId: owner,
    timetableId: timetable,
    subscriptionId: subscription,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    mode: "deliver",
  }),
});

describe("scoped Google recovery for an existing connected student", () => {
  it("limits provider work to one exact existing active connection without enabling enrollment", () => {
    const bindings = recovery();
    expect(googleRecoveryScope(bindings)).toMatchObject({
      owner,
      timetable,
      subscription,
    });
    expect(googleDeliveryTargetAllowed(bindings, subscription)).toBe(true);
    expect(googleDeliveryTargetAllowed(bindings, owner)).toBe(false);
    expect(googleSubscriptionAllowed(bindings, { ...row(), status: "active" })).toBe(true);
    expect(googleEnrollmentAllowed(bindings, owner, timetable)).toBe(false);
    for (const field of ["id", "anonymous_session_id", "timetable_id", "provider"]) {
      expect(
        googleSubscriptionAllowed(bindings, {
          ...row(),
          status: "active",
          [field]: "different",
        }),
      ).toBe(false);
    }
    for (const patch of [
      { status: "failed" },
      { status: "disconnected" },
      { revoked_at: "2026-10-28T00:00:00Z" },
    ]) {
      expect(googleSubscriptionAllowed(bindings, { ...row(), status: "active", ...patch })).toBe(false);
    }
  });

  it("fails closed for production, mismatched release, expired scope and invalid authorization", () => {
    const good = recovery();
    const payload = JSON.parse(good.GOOGLE_RECOVERY_CANARY);
    for (const override of [
      { APP_ENV: "production" },
      { SOURCE_SHA: "b".repeat(40) },
      { ENABLE_GOOGLE_DELIVERY: "true" },
      { GOOGLE_RECOVERY_CANARY: "not-json" },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, subscriptionId: [subscription] }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, ownerId: "*" }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, candidateSha: "b".repeat(40) }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, expiresAt: new Date(0).toISOString() }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, expiresAt: new Date(Date.now() + 48 * 3600000).toISOString() }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, mode: "preview" }) },
      { GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, extra: "unsafe" }) },
    ]) {
      const bindings = { ...good, ...override };
      expect(googleRecoveryScope(bindings)).toBeNull();
      if (bindings.ENABLE_GOOGLE_DELIVERY !== "true") {
        expect(googleDeliveryTargetAllowed(bindings, subscription)).toBe(false);
        expect(googleSubscriptionAllowed(bindings, { ...row(), status: "active" })).toBe(false);
      }
    }
  });
});
