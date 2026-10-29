// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  editor: vi.fn(),
  create: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("../server/supabase/auth.ts", async (original) => ({
  ...(await original<typeof import("../server/supabase/auth.ts")>()),
  requireOperationalAdmin: mocks.guard,
}));
vi.mock("../server/pilotRepository.ts", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository.ts")>()),
  getTimetableEditor: mocks.editor,
  createTimetable: mocks.create,
  createTimetableSession: mocks.add,
  updateTimetableSession: mocks.update,
  deleteTimetableSession: mocks.remove,
  publishTimetable: mocks.publish,
}));
import { AdminAuthError } from "../server/supabase/auth";
import { PilotApiError } from "../server/pilotRepository";
import { handleNativeAdminTimetable } from "../worker/adminTimetable.mjs";

const id = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const sessionId = "a3d25330-a637-42cd-9053-22ed99c66c45";
const path = `/api/admin/timetables/${id}`;
const env = { SUPABASE_URL: "https://fixture.invalid" };
const session = {
  courseCode: "CS101",
  courseName: "Computing",
  weekday: 1,
  startTime: "08:00",
  endTime: "09:00",
};
function request(method = "GET", route = path, body?: unknown, headers = {}) {
  return handleNativeAdminTimetable(
    new Request(`https://preview.example${route}`, {
      method,
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
describe("native admin timetable transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: "actor" } });
    mocks.editor.mockResolvedValue({
      activeVersion: { id: "draft" },
      sessions: [],
    });
    mocks.create.mockResolvedValue({ activeVersion: { id: "draft" } });
    mocks.add.mockResolvedValue({ id: sessionId });
    mocks.update.mockResolvedValue({ id: sessionId });
    mocks.publish.mockResolvedValue({ versionNumber: 2 });
  });
  it("loads editor with request bindings after operational authorization", async () => {
    const response = await request();
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      timetable: { activeVersion: { id: "draft" } },
    });
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(mocks.editor).toHaveBeenCalledWith(id, "actor", env);
    expect(mocks.guard.mock.calls[0][0].headers.authorization).toBe(
      "Bearer fixture",
    );
  });
  it("creates a timetable using only validated fields and the authenticated actor", async () => {
    const response = await request("POST", "/api/admin/timetables", {
      institutionId: id,
      programmeId: id,
      classGroupId: id,
      academicPeriodId: id,
      createdBy: "attacker",
    });
    expect(response?.status).toBe(201);
    expect(await response?.json()).toMatchObject({
      draftVersion: { id: "draft" },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      {
        institutionId: id,
        programmeId: id,
        classGroupId: id,
        academicPeriodId: id,
        createdBy: "actor",
      },
      env,
    );
  });
  it("delegates session CRUD with URL scope and actor overriding body fields", async () => {
    expect(
      (
        await request("POST", `${path}/sessions`, {
          ...session,
          userId: "attacker",
          timetableId: "attacker",
        })
      )?.status,
    ).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith(
      { ...session, timetableId: id, userId: "actor" },
      env,
    );
    expect(
      (await request("PATCH", `${path}/sessions/${sessionId}`, session))
        ?.status,
    ).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      { ...session, timetableId: id, sessionId, userId: "actor" },
      env,
    );
    const deleted = await request("DELETE", `${path}/sessions/${sessionId}`);
    expect(await deleted?.json()).toEqual({
      ok: true,
      deletedSessionId: sessionId,
    });
    expect(mocks.remove).toHaveBeenCalledWith(
      { timetableId: id, sessionId, userId: "actor" },
      env,
    );
  });
  it("publishes via the guarded service and reports durable delivery as pending", async () => {
    const response = await request("POST", `${path}/publish`);
    expect(response?.status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(id, "actor", env);
    expect(await response?.json()).toMatchObject({
      publishResult: { versionNumber: 2 },
      delivery: { status: "pending" },
      googleCalendarSync: { pending: true, attempted: 0 },
    });
  });
  it.each([401, 403] as const)(
    "blocks repository access on authorization failure %s",
    async (status) => {
      mocks.guard.mockRejectedValue(
        new AdminAuthError("FORBIDDEN", "Denied", status),
      );
      expect((await request())?.status).toBe(status);
      expect(mocks.editor).not.toHaveBeenCalled();
    },
  );
  it("preserves publication and conflict errors without leaking database details", async () => {
    mocks.publish.mockRejectedValue(
      new PilotApiError("PUBLISH_FAILED", "Resolve overlaps", 422, {
        secret: "private",
      }),
    );
    const response = await request("POST", `${path}/publish`);
    expect(response?.status).toBe(422);
    expect(await response?.json()).toEqual({
      error: { code: "PUBLISH_FAILED", message: "Resolve overlaps" },
    });
  });
  it("rejects invalid bodies before mutation", async () => {
    expect(
      (await request("POST", `${path}/sessions`, { ...session, weekday: 8 }))
        ?.status,
    ).toBe(422);
    expect(
      (
        await request("POST", `${path}/sessions`, session, {
          "content-type": "text/plain",
        })
      )?.status,
    ).toBe(415);
    expect(
      (
        await request("POST", `${path}/sessions`, {
          ...session,
          notes: "x".repeat(17000),
        })
      )?.status,
    ).toBe(413);
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and cross-origin mutations", async () => {
    const response = await handleNativeAdminTimetable(
      new Request(`https://preview.example${path}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      env,
    );
    expect(response?.status).toBe(422);
    expect(
      (
        await request("POST", `${path}/publish`, undefined, {
          origin: "https://other.example",
        })
      )?.status,
    ).toBe(403);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("returns 405 for owned routes and leaves other transports unclaimed", async () => {
    const response = await request("PUT");
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET");
    for (const suffix of [
      "/corrections",
      "/pauses",
      "/google-calendar-sync",
      "/public-settings",
    ]) {
      expect(await request("POST", `${path}${suffix}`)).toBeNull();
    }
    expect(await request("GET", "/api/admin/timetables")).toBeNull();
    expect(await request("GET", "/api/admin/timetables/not-a-uuid")).toBeNull();
  });
});
