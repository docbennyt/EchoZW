// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "class_rep",
  assigned: true,
  writes: [] as string[],
  envs: [] as unknown[],
  recoveries: 0,
  recoveryFails: false,
}));
vi.mock("../server/supabase/userClient.js", () => ({
  createSupabaseUserClient: () => ({
    auth: {
      getUser: async (token: string) => ({
        data: { user: token === "valid" ? { id: "user" } : null },
        error: null,
      }),
    },
  }),
}));
const timetableId = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const rows =
        table === "staff_users"
          ? [{ id: "staff", user_id: "user", role: state.role, active: true }]
          : state.assigned
            ? [
                {
                  id: "assignment",
                  timetable_id: "08a30b9b-ed8f-4aea-91de-09d4e1124f9a",
                  active: true,
                  timetables: {},
                },
              ]
            : [];
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));
vi.mock("../server/academicPauseRepository.ts", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../server/academicPauseRepository.ts")
    >();
  return {
    ...original,
    listAcademicPauses: vi.fn(async (env) => {
      state.envs.push(env);
      return [];
    }),
    listAcademicPausesForTimetable: vi.fn(async (id, env) => {
      state.envs.push(env);
      return [{ id: "pause", timetableId: id, active: true }];
    }),
  };
});
vi.mock("../server/academicPauseCore.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../server/academicPauseCore.ts")>();
  return {
    ...original,
    previewImpact: vi.fn(async (_input, env) => {
      state.envs.push(env);
      return {
        impact: { affectedTimetableCount: 1, newlySuppressedLectureCount: 2 },
        timetableIds: [],
      };
    }),
    createPauseWithImpact: vi.fn(async (_actor, input, env) => {
      state.envs.push(env);
      state.writes.push("create");
      return {
        pause: input,
        impact: { affectedTimetableCount: 1, newlySuppressedLectureCount: 2 },
      };
    }),
    deactivatePauseWithTimetables: vi.fn(async (input, env) => {
      state.envs.push(env);
      state.writes.push("resume");
      return { pause: { id: input.pauseId, active: false } };
    }),
  };
});
vi.mock("../server/googleCalendarDelivery.ts", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../server/googleCalendarDelivery.ts")
    >();
  return {
    ...original,
    recoverGoogleCalendarDelivery: vi.fn(async () => {
      state.recoveries += 1;
      if (state.recoveryFails) throw new Error("database unavailable");
      return 3;
    }),
  };
});
import worker from "../worker/index.mjs";
const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SECRET_KEY: "fixture",
  VITE_SUPABASE_PUBLISHABLE_KEY: "fixture",
};
const path = `/api/admin/timetables/${timetableId}/pauses`;
const body = {
  startsOn: "2026-10-23",
  endsOn: "2026-10-24",
  reason: "closure",
  label: "Campus closed",
};
function request(
  method = "GET",
  suffix = "",
  payload: unknown = undefined,
  headers = {},
  route = path,
) {
  return worker.fetch(
    new Request(`https://preview.example${route}${suffix}`, {
      method,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        ...headers,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    env,
    { waitUntil: () => {} },
  );
}

describe("native existing timetable pause transport", () => {
  beforeEach(() => {
    state.role = "class_rep";
    state.assigned = true;
    state.writes = [];
    state.envs = [];
    state.recoveries = 0;
    state.recoveryFails = false;
  });
  it("lists only through the scoped timetable service with request bindings", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pauses: [{ timetableId }] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.envs).toEqual([env]);
  });
  it("previews without saving and binds scope from the URL", async () => {
    const response = await request("POST", "/preview", {
      ...body,
      timetableId: "attacker",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      impact: { newlySuppressedLectureCount: 2 },
    });
    expect(state.writes).toEqual([]);
  });
  it("persists Google work without claiming remote delivery", async () => {
    const created = await request("POST", "", body);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      pause: { timetableId },
      googleCalendarSync: {
        pending: true,
        recoveredJobs: 3,
        attempted: 0,
      },
    });
    const resumed = await request(
      "DELETE",
      "/a3d25330-a637-42cd-9053-22ed99c66c45",
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      pause: { active: false },
      googleCalendarSync: { pending: true, recoveredJobs: 3 },
    });
    expect(state.recoveries).toBe(2);
    expect(state.writes).toEqual(["create", "resume"]);
    expect(state.envs.every((value) => value === env)).toBe(true);
  });
  it("reports deferred recovery after a committed pause", async () => {
    state.recoveryFails = true;
    const response = await request("POST", "", body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      googleCalendarSync: {
        pending: true,
        recoveryDeferred: true,
        attempted: 0,
      },
    });
    expect(state.writes).toEqual(["create"]);
    expect(state.recoveries).toBe(1);
  });
  it("denies anonymous, unassigned and cross-origin writes", async () => {
    expect(
      (await request("POST", "", body, { authorization: "" })).status,
    ).toBe(401);
    state.assigned = false;
    expect((await request("POST", "", body)).status).toBe(403);
    state.assigned = true;
    expect(
      (await request("POST", "", body, { origin: "https://attacker.invalid" }))
        .status,
    ).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it("rejects broad scopes and malformed requests before persistence", async () => {
    expect(
      (await request("POST", "", { ...body, scopeType: "institution" })).status,
    ).toBe(422);
    expect(
      (await request("POST", "", body, { "content-type": "text/plain" }))
        .status,
    ).toBe(415);
    expect((await request("PUT", "", body)).status).toBe(405);
    expect(state.writes).toEqual([]);
  });
  it("keeps institution-wide pauses behind operational admin authorization", async () => {
    const route = "/api/admin/academic-pauses";
    const broad = {
      ...body,
      scopeType: "institution",
      institutionId: "783b2fd0-340d-4ac7-b42a-362029a1cd48",
    };
    expect((await request("POST", "", broad, {}, route)).status).toBe(403);
    expect(state.writes).toEqual([]);
    state.role = "admin";
    expect((await request("GET", "", undefined, {}, route)).status).toBe(200);
    expect((await request("POST", "/preview", broad, {}, route)).status).toBe(
      200,
    );
    expect(state.writes).toEqual([]);
    const response = await request("POST", "", broad, {}, route);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      pause: { scopeType: "institution", institutionId: broad.institutionId },
    });
  });
});
