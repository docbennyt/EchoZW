// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  prepareCanarySecrets,
  selectedCanaryBindingPresent,
} from "../scripts/prepare-staging-canary-secrets.mjs";
const sha = "c".repeat(40);
const owner = "11111111-1111-4111-8111-111111111111";
const timetable = "1a641bbb-856e-49b7-8fba-b20a17febf5f";
const subscription = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-10-27T08:00:00Z");
const scope = () => ({
  candidateSha: sha,
  ownerId: owner,
  timetableId: timetable,
  expiresAt: "2026-10-27T09:00:00Z",
});
describe("trusted expiring staging canary bindings", () => {
  it("disables any inherited scope by default without rewriting application configuration", () => {
    expect(prepareCanarySecrets("", sha, false, now)).toEqual({
      GOOGLE_CANARY_EXPIRES_AT: "",
    });
  });
  it("allows enrollment only before a selected subscription binding exists", () => {
    expect(
      prepareCanarySecrets(JSON.stringify(scope()), sha, false, now),
    ).toEqual({
      GOOGLE_CANARY_OWNER_ID: owner,
      GOOGLE_CANARY_TIMETABLE_ID: timetable,
      GOOGLE_CANARY_EXPIRES_AT: scope().expiresAt,
      GOOGLE_REDIRECT_URI:
        "https://next.calender.aido.co.zw/api/calendar/google/callback",
    });
    expect(() =>
      prepareCanarySecrets(JSON.stringify(scope()), sha, true, now),
    ).toThrow("TRUSTED_CANARY_SCOPE_INVALID");
  });
  it("pins the selected scope to the approved SHA and isolated QA timetable", () => {
    expect(
      prepareCanarySecrets(
        JSON.stringify({ ...scope(), subscriptionId: subscription }),
        sha,
        true,
        now,
      ),
    ).toMatchObject({
      GOOGLE_CANARY_SUBSCRIPTION_ID: subscription,
      GOOGLE_REDIRECT_URI:
        "https://next.calender.aido.co.zw/api/calendar/google/callback",
    });
    for (const change of [
      { candidateSha: "f".repeat(40) },
      { timetableId: owner },
      { ownerId: "*" },
      { ownerId: [owner] },
      { subscriptionId: [subscription] },
      { subscriptionId: "id1,id2" },
      { expiresAt: "2099-01-01" },
      { expiresAt: "2026-10-26" },
      { ENABLE_GOOGLE_DELIVERY: "true" },
      {
        GOOGLE_REDIRECT_URI:
          "https://calendar.aido.co.zw/api/calendar/google/callback",
      },
    ]) {
      expect(() =>
        prepareCanarySecrets(
          JSON.stringify({ ...scope(), ...change }),
          sha,
          false,
          now,
        ),
      ).toThrow("TRUSTED_CANARY_SCOPE_INVALID");
    }
  });
  it("redacts malformed input instead of echoing private scope values", () => {
    for (const text of [
      '{"private-owner-value":',
      "[]",
      "null",
      "x".repeat(2049),
    ]) {
      try {
        prepareCanarySecrets(text, sha, false, now);
        throw new Error("EXPECTED_REJECTION");
      } catch (error) {
        expect((error as Error).message).toBe("TRUSTED_CANARY_SCOPE_INVALID");
      }
    }
  });
  it("fails closed when the deployed selection cannot be inspected", async () => {
    const env = {
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_API_TOKEN: "test-only",
    };
    const request = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: {
            bindings: [
              { name: "GOOGLE_CANARY_SUBSCRIPTION_ID", type: "secret_text" },
            ],
          },
        }),
      );
    expect(await selectedCanaryBindingPresent(env, request)).toBe(true);
    expect(
      await selectedCanaryBindingPresent(
        env,
        async () =>
          new Response(
            JSON.stringify({ success: true, result: { bindings: [] } }),
          ),
      ),
    ).toBe(false);
    for (const response of [
      new Response("denied", { status: 403 }),
      new Response(
        JSON.stringify({ success: false, result: { bindings: [] } }),
      ),
      new Response(JSON.stringify({ success: true, result: {} })),
    ]) {
      await expect(
        selectedCanaryBindingPresent(env, async () => response),
      ).rejects.toThrow("TRUSTED_CANARY_SETTINGS_UNAVAILABLE");
    }
  });
});
