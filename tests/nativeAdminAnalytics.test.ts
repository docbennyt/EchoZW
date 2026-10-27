// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  overview: vi.fn(),
  metrics: vi.fn(),
}));
vi.mock("../server/supabase/auth.ts", async (original) => ({
  ...(await original<typeof import("../server/supabase/auth.ts")>()),
  requireOperationalAdmin: mocks.guard,
}));
vi.mock("../server/adminAnalyticsRepository.ts", () => ({
  getAnalyticsOverview: mocks.overview,
  getMetricDefinitions: mocks.metrics,
}));
import worker from "../worker/index.mjs";
import { AdminAuthError } from "../server/supabase/auth";

const env = { SUPABASE_URL: "https://fixture.invalid" };
const request = (path: string, method = "GET") =>
  worker.fetch(
    new Request(`https://qa.example/api/admin/analytics/${path}`, {
      method,
      headers: { authorization: "Bearer fixture" },
    }),
    env,
    { waitUntil: () => {} },
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: "qa-admin" } });
  mocks.metrics.mockReturnValue([{ key: "calendar_verified" }]);
  mocks.overview.mockResolvedValue({ summary: { activeSubscribers: 2 } });
});

describe("native operational admin analytics", () => {
  it("serves metric definitions only after operational admin authorization", async () => {
    const response = await request("metrics");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      metrics: [{ key: "calendar_verified" }],
    });
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("passes validated filters and explicit Worker bindings to the existing repository", async () => {
    const response = await request(
      "overview?from=2026-10-20&to=2026-10-27&provider=google_api",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      summary: { activeSubscribers: 2 },
    });
    expect(mocks.overview).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-10-20",
        to: "2026-10-27",
        provider: "google_api",
        timezone: "Africa/Harare",
      }),
      env,
    );
  });
  it.each([401, 403] as const)(
    "denies unauthorized actors without reading analytics (%i)",
    async (status) => {
      mocks.guard.mockRejectedValue(
        new AdminAuthError("FORBIDDEN", "Access denied.", status),
      );
      expect((await request("overview")).status).toBe(status);
      expect((await request("metrics")).status).toBe(status);
      expect(mocks.overview).not.toHaveBeenCalled();
      expect(mocks.metrics).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid filters without a repository query", async () => {
    const response = await request("overview?from=2026-10-27&to=2026-10-20");
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("reports database failure honestly and recovers on a subsequent request", async () => {
    mocks.overview.mockRejectedValueOnce(new Error("private database detail"));
    const response = await request("overview");
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("ANALYTICS_UNAVAILABLE");
    expect(body).not.toContain("private database detail");
    expect((await request("overview")).status).toBe(200);
  });
  it("rejects unsupported methods without a database call", async () => {
    expect((await request("overview", "POST")).status).toBe(405);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
});
