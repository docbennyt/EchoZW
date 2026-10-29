// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  writes: [] as unknown[],
  failure: false,
  env: null as unknown,
}));
vi.mock("../server/pilotRepository.js", async (load) => ({
  ...(await load<typeof import("../server/pilotRepository.js")>()),
  getCalendarSubscriptionById: vi.fn(async (_id, env) => {
    state.env = env;
    return state.row;
  }),
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: (env: unknown) => {
    state.env = env;
    const chain = {
      from: () => chain,
      update: (patch: unknown) => {
        state.writes.push(patch);
        return chain;
      },
      eq: () => chain,
      then: (resolve: (result: unknown) => unknown) =>
        Promise.resolve({ error: state.failure ? {} : null }).then(resolve),
    };
    return chain;
  },
}));
import { revokeOwnedFeedSubscription } from "../server/calendarSubscriptionLifecycle.js";
const env = { SUPABASE_URL: "https://fixture.invalid" };
describe("existing private feed revocation", () => {
  beforeEach(() => {
    state.row = {
      id: "subscription",
      anonymous_session_id: "owner",
      provider: "apple_subscription",
      revoked_at: null,
    };
    state.writes = [];
    state.failure = false;
  });
  it("revokes only the owner connection without replacing tokens", async () => {
    expect(
      await revokeOwnedFeedSubscription("subscription", "owner", env),
    ).toMatchObject({ ok: true });
    expect(state.writes).toEqual([
      expect.objectContaining({
        status: "disconnected",
        token_hash: null,
        revoked_at: expect.any(String),
      }),
    ]);
    expect(state.env).toBe(env);
  });
  it("leaves missing and foreign subscriptions untouched", async () => {
    await expect(
      revokeOwnedFeedSubscription("subscription", null, env),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      revokeOwnedFeedSubscription("subscription", "other", env),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.row = null;
    await expect(
      revokeOwnedFeedSubscription("missing", "owner", env),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
    expect(state.writes).toEqual([]);
  });
  it("is idempotent and leaves Google disconnect to its authorized service", async () => {
    state.row!.revoked_at = "2026-10-23T00:00:00Z";
    expect(
      await revokeOwnedFeedSubscription("subscription", "owner", env),
    ).toMatchObject({ ok: true });
    state.row!.provider = "google_api";
    await expect(
      revokeOwnedFeedSubscription("subscription", "owner", env),
    ).rejects.toMatchObject({ code: "GOOGLE_DISCONNECT_REQUIRED" });
    expect(state.writes).toEqual([]);
  });
  it("reports durable database failure", async () => {
    state.failure = true;
    await expect(
      revokeOwnedFeedSubscription("subscription", "owner", env),
    ).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });
});
