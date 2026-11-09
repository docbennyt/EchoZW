// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn() }));
vi.mock("../server/calendarSubscriptionCore.ts", () => ({
  createNativeFeedSubscription: services.create,
}));
vi.mock("../server/calendarSubscriptionLifecycle.ts", () => ({
  revokeOwnedFeedSubscription: services.revoke,
}));
import worker from "../worker/index.mjs";

const backend = "https://backend.example";
const publicOrigin = "https://calendar.example";
const owner = "33333333-3333-4333-8333-333333333333";
const subscription = "11111111-1111-4111-8111-111111111111";
const env = {
  PUBLIC_APP_URL: publicOrigin,
  SUPABASE_URL: "https://fixture.invalid",
  SUPABASE_SECRET_KEY: "fixture-only",
  VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-only",
};
const paths = {
  create: "/api/calendar/subscriptions",
  revoke: `/api/calendar/subscriptions/${subscription}/revoke`,
};
const request = (
  operation: keyof typeof paths,
  headers: Record<string, string>,
  bindings: Partial<typeof env> = env,
) =>
  worker.fetch(
    new Request(backend + paths[operation], {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `calenderzw_anon_session=${owner}`,
        ...headers,
      },
      body: JSON.stringify({
        timetableId: "22222222-2222-4222-8222-222222222222",
        provider: "apple_subscription",
        reminderPreset: "on_time",
      }),
    }),
    bindings,
    { waitUntil: () => {} },
  );

describe("public subscription requests forwarded to the backend", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.create.mockResolvedValue({ subscriptionId: subscription });
    services.revoke.mockResolvedValue({ ok: true });
  });

  it.each(["create", "revoke"] as const)(
    "accepts configured public-origin %s and keeps the cookie owner",
    async (operation) => {
      const response = await request(operation, {
        origin: publicOrigin,
        "sec-fetch-site": "same-origin",
      });
      expect(response.status).toBe(operation === "create" ? 201 : 200);
      if (operation === "create") {
        expect(services.create).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ anonymousSessionId: owner, env }),
        );
        expect(response.headers.get("set-cookie")).toContain(
          `calenderzw_anon_session=${owner}; HttpOnly; Secure; SameSite=Lax`,
        );
      } else {
        expect(services.revoke).toHaveBeenCalledWith(subscription, owner, env);
      }
    },
  );

  it.each(["create", "revoke"] as const)(
    "accepts direct backend %s",
    async (operation) => {
      expect((await request(operation, { origin: backend })).status).toBe(
        operation === "create" ? 201 : 200,
      );
    },
  );

  it.each(["create", "revoke"] as const)(
    "denies foreign, cross-site, unconfigured and unproved public %s before services",
    async (operation) => {
      for (const [headers, bindings] of [
        [
          { origin: "https://evil.invalid", "sec-fetch-site": "same-origin" },
          env,
        ],
        [{ origin: publicOrigin, "sec-fetch-site": "cross-site" }, env],
        [{ origin: backend, "sec-fetch-site": "cross-site" }, env],
        [{ origin: publicOrigin }, env],
        [{ origin: publicOrigin, "sec-fetch-site": "same-site" }, env],
        [
          { origin: publicOrigin, "sec-fetch-site": "same-origin" },
          { ...env, PUBLIC_APP_URL: undefined },
        ],
      ] as [Record<string, string>, Partial<typeof env>][]) {
        expect((await request(operation, headers, bindings)).status).toBe(403);
      }
      expect(services.create).not.toHaveBeenCalled();
      expect(services.revoke).not.toHaveBeenCalled();
    },
  );

  it("retains origin-less server enrollment and rejects origin-less revocation", async () => {
    expect((await request("create", {})).status).toBe(201);
    expect((await request("revoke", {})).status).toBe(403);
  });
});
