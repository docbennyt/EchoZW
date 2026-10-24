// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../server/supabase/auth.ts", async (load) => ({
  ...(await load<typeof import("../server/supabase/auth.ts")>()),
  requireFounderSuperadmin: mocks.guard,
}));
vi.mock("../server/timetablePublicSettingsRepository.ts", async (load) => ({
  ...(await load<
    typeof import("../server/timetablePublicSettingsRepository.ts")
  >()),
  getTimetablePublicDisplaySettings: mocks.read,
  updateTimetablePublicDisplaySettings: mocks.write,
}));
import { AdminAuthError } from "../server/supabase/auth";
import worker from "../worker/index.mjs";
const id = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const env = { SUPABASE_URL: "https://fixture.invalid" };
const settings = { showVisualPreview: true, showChangeAlerts: false };
const request = (method = "GET", body: unknown = undefined, headers = {}) =>
  worker.fetch(
    new Request(
      `https://preview.example/api/admin/timetables/${id}/public-settings`,
      {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
    env,
    { waitUntil: () => {} },
  );
describe("native founder public settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({ staff: { id: "founder-staff" } });
    mocks.read.mockResolvedValue(settings);
    mocks.write.mockResolvedValue(settings);
  });
  it("preserves the founder guard and request-scoped reads", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings });
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledWith(id, env);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("passes only validated settings and the authenticated staff identity", async () => {
    expect((await request("PUT", settings)).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(
      { timetableId: id, staffUserId: "founder-staff", ...settings },
      env,
    );
    expect(
      (await request("PUT", { ...settings, staffUserId: "attacker" })).status,
    ).toBe(422);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("does not read or write after authorization failure", async () => {
    mocks.guard.mockRejectedValue(
      new AdminAuthError("FORBIDDEN", "Founder access required.", 403),
    );
    expect((await request("PUT", settings)).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("denies cross-origin writes and unsupported methods", async () => {
    expect(
      (await request("PUT", settings, { origin: "https://other.invalid" }))
        .status,
    ).toBe(403);
    expect((await request("POST", settings)).status).toBe(405);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
});
