// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  googleOnboardingScope,
  googleOnboardingEnrollmentAllowed,
  googleOnboardingConnectionAllowed,
  googleOnboardingDeliveryAllowed,
} from "../server/googleOnboardingPolicy";
const owner = "11111111-1111-4111-8111-111111111111",
  timetable = "22222222-2222-4222-8222-222222222222",
  sub = "33333333-3333-4333-8333-333333333333";
const issuedAt = new Date(Date.now() - 60000).toISOString();
const scope = () => ({
  mode: "new",
  phase: "enroll",
  candidateSha: "a".repeat(40),
  ownerId: owner,
  timetableId: timetable,
  subscriptionId: null,
  issuedAt,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  revision: 4,
  connectionGeneration: 0,
  calendarIdHash: null,
  deliveryRevision: null,
  deliveryGeneration: null,
  maxCreates: 32,
  maxUpdates: 0,
  maxDeletes: 0,
});
const env = (patch = {}) => ({
  APP_ENV: "cloudflare-production",
  ENABLE_GOOGLE_DELIVERY: "false",
  SOURCE_SHA: "a".repeat(40),
  GOOGLE_PRODUCTION_ONBOARDING: JSON.stringify({ ...scope(), ...patch }),
});
const row = () => ({
  id: sub,
  anonymous_session_id: owner,
  timetable_id: timetable,
  provider: "google_api",
  status: "pending",
  revoked_at: null,
  created_at: new Date().toISOString(),
  google_connection_generation: 0,
  external_calendar_id: null,
});
describe("protected production onboarding scope", () => {
  it("allows enrollment only for the named owner and timetable, without OAuth or delivery authority", () => {
    expect(googleOnboardingEnrollmentAllowed(env(), owner, timetable)).toBe(
      true,
    );
    expect(googleOnboardingEnrollmentAllowed(env(), sub, timetable)).toBe(
      false,
    );
    expect(googleOnboardingConnectionAllowed(env(), row())).toBe(false);
    expect(
      googleOnboardingDeliveryAllowed(env(), row(), new Date().toISOString()),
    ).toBe(false);
  });
  it.each([
    { APP_ENV: "cloudflare-staging" },
    { SOURCE_SHA: "b".repeat(40) },
    { ENABLE_GOOGLE_DELIVERY: "true" },
  ])("rejects wrong environment or deployed source %#", (patch) => {
    expect(googleOnboardingScope({ ...env(), ...patch })).toBeNull();
  });
  it.each([
    { expiresAt: new Date(0).toISOString() },
    { expiresAt: new Date(Date.now() + 172800000).toISOString() },
    { issuedAt: new Date(Date.now() + 60000).toISOString() },
    { ownerId: "*" },
    { phase: "unknown" },
    { maxCreates: 33 },
    { maxCreates: 32, maxUpdates: 1 },
    { maxDeletes: 1 },
    { extra: "unsafe" },
  ])("fails closed for invalid scope %#", (patch) => {
    expect(googleOnboardingScope(env(patch))).toBeNull();
  });
  it("requires a selected fresh pending subscription for consent and denies historical pending rows", () => {
    const bindings = env({ phase: "connect", subscriptionId: sub });
    expect(googleOnboardingConnectionAllowed(bindings, row())).toBe(true);
    expect(
      googleOnboardingConnectionAllowed(bindings, {
        ...row(),
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      googleOnboardingConnectionAllowed(bindings, {
        ...row(),
        external_calendar_id: "existing-calendar",
      }),
    ).toBe(false);
    for (const field of [
      "id",
      "anonymous_session_id",
      "timetable_id",
      "provider",
      "google_connection_generation",
    ])
      expect(
        googleOnboardingConnectionAllowed(bindings, {
          ...row(),
          [field]: "other",
        }),
      ).toBe(false);
    expect(
      googleOnboardingDeliveryAllowed(
        bindings,
        row(),
        new Date().toISOString(),
      ),
    ).toBe(false);
  });
  it("requires exact reconnect calendar identity and fresh consented credentials before delivery", () => {
    const calendar = "existing-private-calendar";
    const reconnect = {
      ...row(),
      created_at: "2026-01-01T00:00:00Z",
      external_calendar_id: calendar,
      status: "failed",
    };
    const payload = {
      mode: "reconnect",
      phase: "connect",
      subscriptionId: sub,
      calendarIdHash: createHash("sha256").update(calendar).digest("hex"),
    };
    expect(googleOnboardingConnectionAllowed(env(payload), reconnect)).toBe(
      true,
    );
    expect(
      googleOnboardingConnectionAllowed(env(payload), {
        ...reconnect,
        external_calendar_id: "other",
      }),
    ).toBe(false);
    const deliver = env({
      ...payload,
      phase: "deliver",
      deliveryRevision: 4,
      deliveryGeneration: 2,
    });
    expect(
      googleOnboardingDeliveryAllowed(
        deliver,
        reconnect,
        "2026-01-01T00:00:00Z",
      ),
    ).toBe(false);
    expect(googleOnboardingDeliveryAllowed(deliver, reconnect)).toBe(false);
    expect(
      googleOnboardingDeliveryAllowed(
        deliver,
        reconnect,
        new Date().toISOString(),
      ),
    ).toBe(true);
    expect(
      googleOnboardingDeliveryAllowed(
        deliver,
        { ...reconnect, revoked_at: new Date().toISOString() },
        new Date().toISOString(),
      ),
    ).toBe(false);
  });
});
