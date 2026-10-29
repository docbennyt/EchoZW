import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  beginGoogleCalendarConnection: vi.fn(),
  checkGoogleCredentialCompatibility: vi.fn(),
  completeGoogleCalendarConnection: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  getPublicGoogleCalendarStatus: vi.fn(),
  previewGoogleSubscriptionSync: vi.fn(),
  syncGoogleSubscription: vi.fn(),
}));
const repository = vi.hoisted(() => ({ getCalendarSubscriptionById: vi.fn() }));
const auth = vi.hoisted(() => ({ requireOperationalAdmin: vi.fn() }));
vi.mock("../server/googleCalendarSync", () => services);
vi.mock("../server/pilotRepository", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository")>()),
  ...repository,
}));
vi.mock("../server/supabase/auth", async (original) => ({
  ...(await original<typeof import("../server/supabase/auth")>()),
  ...auth,
}));
import { handleGoogleCalendarRequest } from "../worker/googleCalendarApi.mjs";
import { PilotApiError } from "../server/pilotRepository";
import { AdminAuthError } from "../server/supabase/auth";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const timetableId = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const env = {
  ENABLE_GOOGLE_DELIVERY: "true",
  PUBLIC_APP_URL: "https://calendar.example",
  TOKEN_ENCRYPTION_KEY: "test-only-original-key",
};
const syncPath = `/api/admin/timetables/${timetableId}/google-calendar-sync`;
function request(path: string, body?: unknown, headers = {}) {
  return new Request(
    `https://worker.example${path}`,
    body === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
  );
}
const options = { enqueueInitialSync: vi.fn(), enqueueReconciliation: vi.fn() };

describe("native Google Web transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.getPublicGoogleCalendarStatus.mockReturnValue({
      enabled: false,
      scope: "calendar.app.created",
    });
    services.beginGoogleCalendarConnection.mockResolvedValue(
      new URL("https://accounts.google.com/oauth"),
    );
    services.completeGoogleCalendarConnection.mockResolvedValue({
      subscriptionId,
      publicSlug: "class-slug",
    });
    services.disconnectGoogleCalendar.mockResolvedValue({ ok: true });
    services.previewGoogleSubscriptionSync.mockResolvedValue({
      readOnly: true,
      unchanged: 15,
    });
    repository.getCalendarSubscriptionById.mockResolvedValue({
      id: subscriptionId,
      timetable_id: timetableId,
      provider: "google_api",
      status: "active",
    });
  });

  it("returns null for unrelated routes and safely exposes disabled status", async () => {
    expect(
      await handleGoogleCalendarRequest(
        request("/api/calendar/subscriptions"),
        env,
      ),
    ).toBeNull();
    const response = await handleGoogleCalendarRequest(
      request("/api/calendar/google/status"),
      env,
    );
    expect(await response!.json()).toEqual({
      enabled: false,
      scope: "calendar.app.created",
    });
    expect(response!.headers.get("cache-control")).toBe("no-store");
    expect(services.getPublicGoogleCalendarStatus).toHaveBeenCalledWith(env);
  });
  it("keeps the canary status private to its owner and rejects other subscriptions before OAuth", async () => {
    const bindings = {
      ...env,
      APP_ENV: "cloudflare-staging",
      ENABLE_GOOGLE_DELIVERY: "false",
      GOOGLE_CANARY_OWNER_ID: owner,
      GOOGLE_CANARY_TIMETABLE_ID: timetableId,
      GOOGLE_CANARY_SUBSCRIPTION_ID: subscriptionId,
      GOOGLE_CANARY_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
    };
    services.getPublicGoogleCalendarStatus.mockReturnValue({ enabled: true });
    const status = "/api/calendar/google/status";
    expect(
      await (await handleGoogleCalendarRequest(
        request(status),
        bindings,
      ))!.json(),
    ).toMatchObject({ enabled: false });
    expect(
      await (await handleGoogleCalendarRequest(
        request(status, undefined, {
          cookie: `calenderzw_anon_session=${owner}`,
        }),
        bindings,
      ))!.json(),
    ).toMatchObject({ enabled: true });
    repository.getCalendarSubscriptionById.mockResolvedValue({
      id: subscriptionId,
      provider: "google_api",
      timetable_id: timetableId,
      anonymous_session_id: owner,
    });
    expect(
      (await handleGoogleCalendarRequest(
        request(
          `/api/calendar/google/connect?subscriptionId=${subscriptionId}`,
          undefined,
          { cookie: `calenderzw_anon_session=${owner}` },
        ),
        bindings,
      ))!.status,
    ).toBe(302);
    services.beginGoogleCalendarConnection.mockClear();
    repository.getCalendarSubscriptionById.mockResolvedValue({ id: owner });
    expect(
      (await handleGoogleCalendarRequest(
        request(
          `/api/calendar/google/connect?subscriptionId=${owner}`,
          undefined,
          { cookie: `calenderzw_anon_session=${owner}` },
        ),
        bindings,
      ))!.status,
    ).toBe(503);
    expect(services.beginGoogleCalendarConnection).not.toHaveBeenCalled();
  });

  it("checks credential compatibility only after admin and ownership checks without provider work", async () => {
    services.checkGoogleCredentialCompatibility.mockResolvedValue({
      readOnly: true,
      decryptionCompatible: true,
      providerAuthorizationVerified: false,
    });
    const body = { subscriptionId, dryRun: true, credentialCheckOnly: true };
    const response = await handleGoogleCalendarRequest(
      request(syncPath, body),
      env,
    );
    expect(response!.status).toBe(200);
    expect(auth.requireOperationalAdmin).toHaveBeenCalledOnce();
    expect(services.checkGoogleCredentialCompatibility).toHaveBeenCalledWith(
      subscriptionId,
      env,
    );
    expect(services.previewGoogleSubscriptionSync).not.toHaveBeenCalled();
    expect(services.syncGoogleSubscription).not.toHaveBeenCalled();
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
    expect(response!.headers.get("cache-control")).toBe("no-store");
    repository.getCalendarSubscriptionById.mockResolvedValue({
      id: subscriptionId,
      timetable_id: owner,
      provider: "google_api",
      status: "active",
    });
    services.checkGoogleCredentialCompatibility.mockClear();
    expect(
      (await handleGoogleCalendarRequest(request(syncPath, body), env))!.status,
    ).toBe(403);
    expect(services.checkGoogleCredentialCompatibility).not.toHaveBeenCalled();
  });

  it("rejects a credential diagnostic combined with a write", async () => {
    const response = await handleGoogleCalendarRequest(
      request(syncPath, {
        subscriptionId,
        dryRun: false,
        credentialCheckOnly: true,
      }),
      env,
      options,
    );
    expect(response!.status).toBe(422);
    expect(services.checkGoogleCredentialCompatibility).not.toHaveBeenCalled();
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
  });

  it("connects using the existing HttpOnly anonymous cookie and explicit env", async () => {
    const response = await handleGoogleCalendarRequest(
      request(
        `/api/calendar/google/connect?subscriptionId=${subscriptionId}`,
        undefined,
        { cookie: `other=x; calenderzw_anon_session=${owner}` },
      ),
      env,
    );
    expect(response!.status).toBe(302);
    expect(services.beginGoogleCalendarConnection).toHaveBeenCalledWith({
      subscriptionId,
      anonymousSessionId: owner,
      env,
    });
    expect(response!.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("preserves header owner precedence and the service owner denial", async () => {
    services.beginGoogleCalendarConnection.mockRejectedValue(
      new PilotApiError("SUBSCRIPTION_NOT_FOUND", "Not found", 404),
    );
    const response = await handleGoogleCalendarRequest(
      request(
        `/api/calendar/google/connect?subscriptionId=${subscriptionId}`,
        undefined,
        {
          "x-calenderzw-anonymous-id": owner,
          cookie: "calenderzw_anon_session=bad",
        },
      ),
      env,
    );
    expect(response!.status).toBe(404);
    expect(
      services.beginGoogleCalendarConnection.mock.calls[0][0]
        .anonymousSessionId,
    ).toBe(owner);
  });

  it("requires durable initial enqueue before consuming callback state", async () => {
    const response = await handleGoogleCalendarRequest(
      request(
        "/api/calendar/google/callback?code=private-code&state=private-state",
      ),
      env,
    );
    expect(response!.status).toBe(503);
    expect(services.completeGoogleCalendarConnection).not.toHaveBeenCalled();
    expect(await response!.text()).not.toContain("private-");
  });

  it("reports disabled delivery and blocks callbacks and writes before services or enqueue", async () => {
    services.getPublicGoogleCalendarStatus.mockReturnValue({
      enabled: true,
      scope: "calendar.app.created",
    });
    const disabled = { ...options, deliveryEnabled: false };
    const status = await handleGoogleCalendarRequest(
      request("/api/calendar/google/status"),
      env,
      disabled,
    );
    expect((await status!.json()).enabled).toBe(false);
    const callback = await handleGoogleCalendarRequest(
      request(
        "/api/calendar/google/callback?code=private-code&state=private-state",
      ),
      env,
      disabled,
    );
    expect(callback!.status).toBe(503);
    expect(services.completeGoogleCalendarConnection).not.toHaveBeenCalled();
    expect(
      (await handleGoogleCalendarRequest(
        request(syncPath, { subscriptionId, dryRun: false }),
        env,
        disabled,
      ))!.status,
    ).toBe(503);
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
  });

  it("injects initial enqueue and redirects only to the configured application", async () => {
    const response = await handleGoogleCalendarRequest(
      request(
        "/api/calendar/google/callback?code=private-code&state=private-state",
        undefined,
        { "x-forwarded-host": "evil.invalid" },
      ),
      env,
      options,
    );
    expect(services.completeGoogleCalendarConnection).toHaveBeenCalledWith({
      code: "private-code",
      state: "private-state",
      env,
      enqueueInitialSync: options.enqueueInitialSync,
    });
    expect(response!.headers.get("location")).toBe(
      `https://calendar.example/t/class-slug?calendar=google-success&subscriptionId=${subscriptionId}`,
    );
    expect(response!.headers.get("location")).not.toContain("private-");
    expect(services.syncGoogleSubscription).not.toHaveBeenCalled();
  });

  it("redacts callback failures and provider-controlled errors from redirects", async () => {
    services.completeGoogleCalendarConnection.mockRejectedValue(
      new Error("secret-token"),
    );
    const failed = await handleGoogleCalendarRequest(
      request("/api/calendar/google/callback?code=private&state=private"),
      env,
      options,
    );
    expect(failed!.headers.get("location")).toBe(
      "https://calendar.example/find?calendar=google-failed",
    );
    const cancelled = await handleGoogleCalendarRequest(
      request("/api/calendar/google/callback?error=secret-token"),
      env,
      options,
    );
    expect(cancelled!.headers.get("location")).toBe(
      "https://calendar.example/find?calendar=google-cancelled",
    );
  });

  it("disconnects only with an explicit boolean and propagates the cookie owner", async () => {
    const invalid = await handleGoogleCalendarRequest(
      request("/api/calendar/google/disconnect", {
        subscriptionId,
        deleteCreatedCalendar: "false",
      }),
      env,
    );
    expect(invalid!.status).toBe(422);
    expect(services.disconnectGoogleCalendar).not.toHaveBeenCalled();
    const response = await handleGoogleCalendarRequest(
      request(
        "/api/calendar/google/disconnect",
        { subscriptionId, deleteCreatedCalendar: false },
        { cookie: `calenderzw_anon_session=${owner}` },
      ),
      env,
    );
    expect(response!.status).toBe(200);
    expect(services.disconnectGoogleCalendar).toHaveBeenCalledWith({
      subscriptionId,
      anonymousSessionId: owner,
      deleteCreatedCalendar: false,
      env,
    });
  });

  it("rejects wrong methods, cross-origin posts, bad JSON, and oversized bodies", async () => {
    expect(
      (await handleGoogleCalendarRequest(
        request("/api/calendar/google/disconnect"),
        env,
      ))!.status,
    ).toBe(405);
    expect(
      (await handleGoogleCalendarRequest(
        request(
          "/api/calendar/google/disconnect",
          { subscriptionId },
          { origin: "https://evil.invalid" },
        ),
        env,
      ))!.status,
    ).toBe(403);
    for (const [body, status] of [
      ["{", 422],
      ["x".repeat(16385), 413],
    ] as const) {
      const response = await handleGoogleCalendarRequest(
        new Request("https://worker.example/api/calendar/google/disconnect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        env,
      );
      expect(response!.status).toBe(status);
    }
    expect(services.disconnectGoogleCalendar).not.toHaveBeenCalled();
  });

  it("denies non-operational admins before any subscription or provider access", async () => {
    auth.requireOperationalAdmin.mockRejectedValue(
      new AdminAuthError("OPERATIONAL_ADMIN_REQUIRED", "Admin required", 403),
    );
    expect(
      (await handleGoogleCalendarRequest(
        request(syncPath, { subscriptionId, dryRun: true }),
        env,
        options,
      ))!.status,
    ).toBe(403);
    expect(repository.getCalendarSubscriptionById).not.toHaveBeenCalled();
    expect(services.previewGoogleSubscriptionSync).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { subscriptionId },
    { subscriptionId, dryRun: "false" },
    { dryRun: false },
  ])("rejects a missing target or explicit boolean mode: %j", async (body) => {
    expect(
      (await handleGoogleCalendarRequest(
        request(syncPath, body),
        env,
        options,
      ))!.status,
    ).toBe(422);
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
    expect(services.syncGoogleSubscription).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: "apple" }, 400],
    [{ timetable_id: "another-class" }, 403],
    [{ revoked_at: "2026-10-01" }, 409],
    [{ status: "disconnected" }, 409],
  ])("guards targeted ownership and lifecycle: %j", async (patch, status) => {
    repository.getCalendarSubscriptionById.mockResolvedValue({
      id: subscriptionId,
      timetable_id: timetableId,
      provider: "google_api",
      ...patch,
    });
    expect(
      (await handleGoogleCalendarRequest(
        request(syncPath, { subscriptionId, dryRun: false }),
        env,
        options,
      ))!.status,
    ).toBe(status);
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
  });

  it("previews only the explicit subscription and queues writes with 202", async () => {
    const preview = await handleGoogleCalendarRequest(
      request(syncPath, { subscriptionId, dryRun: true }),
      env,
      options,
    );
    expect(preview!.status).toBe(200);
    expect(services.previewGoogleSubscriptionSync).toHaveBeenCalledWith(
      subscriptionId,
      env,
    );
    expect(options.enqueueReconciliation).not.toHaveBeenCalled();
    const queued = await handleGoogleCalendarRequest(
      request(syncPath, { subscriptionId, dryRun: false }),
      env,
      options,
    );
    expect(queued!.status).toBe(202);
    expect(await queued!.json()).toEqual({
      googleCalendarSync: { queued: true, subscriptionId, timetableId },
    });
    expect(options.enqueueReconciliation).toHaveBeenCalledWith(
      { subscriptionId, timetableId },
      env,
    );
    expect(services.syncGoogleSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when reconciliation enqueue is missing or fails", async () => {
    expect(
      (await handleGoogleCalendarRequest(
        request(syncPath, { subscriptionId, dryRun: false }),
        env,
      ))!.status,
    ).toBe(503);
    options.enqueueReconciliation.mockRejectedValue(
      new Error("private-queue-value"),
    );
    const response = await handleGoogleCalendarRequest(
      request(syncPath, { subscriptionId, dryRun: false }),
      env,
      options,
    );
    expect(response!.status).toBe(500);
    expect(await response!.text()).not.toContain("private-");
  });
});
