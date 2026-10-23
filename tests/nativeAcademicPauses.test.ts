// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assigned: true,
  writes: [] as string[],
  envs: [] as unknown[],
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
          ? [{ id: "staff", user_id: "user", role: "class_rep", active: true }]
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
) {
  return worker.fetch(
    new Request(`https://preview.example${path}${suffix}`, {
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
    state.assigned = true;
    state.writes = [];
    state.envs = [];
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
  it("creates and resumes using existing services without pretending Google propagated", async () => {
    const created = await request("POST", "", body);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      pause: { timetableId },
      googleCalendarSync: { skipped: true, attempted: 0 },
    });
    const resumed = await request(
      "DELETE",
      "/a3d25330-a637-42cd-9053-22ed99c66c45",
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ pause: { active: false } });
    expect(state.writes).toEqual(["create", "resume"]);
    expect(state.envs.every((value) => value === env)).toBe(true);
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
});
