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

describe("single-subscription recovery policy", () => {
  it("permits one existing active account, never new enrollments", () => {
    const bindings = recovery();
    const active = { ...row(), status: "active" };
    expect(googleRecoveryScope(bindings)).toMatchObject({
      owner,
      timetable,
      subscription,
    });
    expect(googleDeliveryTargetAllowed(bindings, subscription)).toBe(true);
    expect(googleDeliveryTargetAllowed(bindings, owner)).toBe(false);
    expect(googleDeliveryTargetAllowed({}, undefined)).toBe(false);
    expect(googleSubscriptionAllowed(bindings, active)).toBe(true);
    expect(googleEnrollmentAllowed(bindings, owner, timetable)).toBe(false);
    for (const field of [
      "id",
      "anonymous_session_id",
      "timetable_id",
      "provider",
    ]) {
      expect(
        googleSubscriptionAllowed(bindings, {
          ...active,
          [field]: "different",
        }),
      ).toBe(false);
    }
    for (const patch of [
      { status: "failed" },
      { status: "disconnected" },
      { revoked_at: "2026-10-28T00:00:00Z" },
    ]) {
      expect(
        googleSubscriptionAllowed(bindings, { ...active, ...patch }),
      ).toBe(false);
    }
  });

  it("rejects invalid, expired, and cross-release scope", () => {
    const good = recovery();
    const payload = JSON.parse(good.GOOGLE_RECOVERY_CANARY);
    const secret = (patch: Record<string, unknown>) => ({
      GOOGLE_RECOVERY_CANARY: JSON.stringify({ ...payload, ...patch }),
    });
    for (const override of [
      { APP_ENV: "production" },
      { SOURCE_SHA: "b".repeat(40) },
      { ENABLE_GOOGLE_DELIVERY: "true" },
      { GOOGLE_RECOVERY_CANARY: "not-json" },
      secret({ subscriptionId: [subscription] }),
      secret({ ownerId: "*" }),
      secret({ candidateSha: "b".repeat(40) }),
      secret({ expiresAt: new Date(0).toISOString() }),
      secret({
        expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
      }),
      secret({ mode: "preview" }),
      secret({ extra: "unsafe" }),
    ]) {
      const bindings = { ...good, ...override };
      expect(googleRecoveryScope(bindings)).toBeNull();
      if (bindings.ENABLE_GOOGLE_DELIVERY !== "true") {
        expect(googleDeliveryTargetAllowed(bindings, subscription)).toBe(false);
        expect(
          googleSubscriptionAllowed(bindings, { ...row(), status: "active" }),
        ).toBe(false);
      }
    }
  });
});
