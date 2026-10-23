// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: mocks.client,
}));
import {
  createTimetable,
  getTimetableEditor,
  createTimetableSession,
  updateTimetableSession,
  deleteTimetableSession,
  publishTimetable,
} from "../server/pilotRepository";

function fixture(
  options: {
    dates?: boolean;
    published?: boolean;
    empty?: boolean;
    rpcError?: string;
  } = {},
) {
  let draft = !options.published;
  const writes: Array<{
    table: string;
    operation: string;
    payload: unknown;
    filters: unknown[];
  }> = [];
  const row = {
    id: "timetable",
    public_slug: "fixture",
    institution_id: "institution",
    programme_id: "programme",
    cohort_id: "cohort",
    academic_period_id: "period",
    institutions: { name: "Institution" },
    programmes: { name: "Programme" },
    cohorts: { label: "1.1" },
    academic_periods: {
      name: "Semester",
      starts_on: options.dates === false ? null : "2026-08-01",
      ends_on: options.dates === false ? null : "2026-12-01",
    },
  };
  const session = {
    id: "session",
    timetable_version_id: "draft",
    stable_session_key: "stable",
    course_code: "CS101",
    course_name: "Computing",
    weekday: 1,
    start_time: "08:00:00",
    end_time: "09:00:00",
  };
  const client = {
    rpc: vi.fn(async () => ({
      data: [
        {
          public_slug: "fixture",
          version_number: 2,
          session_count: 1,
          published_at: "2026-10-23T10:00:00Z",
        },
      ],
      error: options.rpcError ? { message: options.rpcError } : null,
    })),
    from(table: string) {
      let columns = "";
      let operation = "select";
      let payload: unknown;
      const filters: unknown[] = [];
      function result(single = false): { data: unknown; error: null } {
        if (operation !== "select") {
          writes.push({ table, operation, payload, filters });
          if (table === "timetable_versions") draft = true;
          return {
            data:
              table === "timetable_sessions"
                ? session
                : {
                    id: table === "timetable_versions" ? "draft" : "timetable",
                  },
            error: null,
          };
        }
        if (table === "institutions")
          return {
            data: { id: "institution", name: "Institution" },
            error: null,
          };
        if (table === "programmes")
          return {
            data: {
              id: "programme",
              institution_id: "institution",
              name: "Programme",
            },
            error: null,
          };
        if (table === "cohorts")
          return {
            data: { id: "cohort", programme_id: "programme", label: "1.1" },
            error: null,
          };
        if (table === "academic_periods")
          return {
            data: {
              id: "period",
              institution_id: "institution",
              name: "Semester",
            },
            error: null,
          };
        if (table === "timetables")
          return { data: single ? row : [], error: null };
        if (table === "timetable_versions")
          return {
            data: [
              {
                id: draft ? "draft" : "published",
                status: draft ? "draft" : "published",
                version_number: 1,
              },
            ],
            error: null,
          };
        if (table === "timetable_sessions")
          return {
            data: single
              ? session
              : options.empty
                ? []
                : [
                    {
                      ...session,
                      ...(columns === "*"
                        ? { starts_on: "2026-08-01", ends_on: "2026-12-01" }
                        : {}),
                    },
                  ],
            error: null,
          };
        throw new Error(`Unexpected table ${table}`);
      }
      const chain = {
        select(value: string) {
          columns = value;
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        in() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        insert(value: unknown) {
          operation = "insert";
          payload = value;
          return chain;
        },
        update(value: unknown) {
          operation = "update";
          payload = value;
          return chain;
        },
        delete() {
          operation = "delete";
          return chain;
        },
        single: async () => result(true),
        maybeSingle: async () => result(true),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client, writes };
}
const input = {
  timetableId: "timetable",
  userId: "actor",
  courseCode: "CS101",
  courseName: "Computing",
  weekday: 1,
  startTime: "08:00",
  endTime: "09:00",
};
const env = { SUPABASE_URL: "https://request.invalid" };
describe("Worker timetable repository bindings and existing gates", () => {
  beforeEach(() => vi.resetAllMocks());
  it("keeps concurrent editor and published-to-draft recovery reads in their request environment", async () => {
    const first = fixture({ published: true });
    const second = fixture();
    const otherEnv = { SUPABASE_URL: "https://other.invalid" };
    mocks.client.mockImplementation((bindings) => {
      expect([env, otherEnv]).toContain(bindings);
      return bindings === env ? first.client : second.client;
    });
    await Promise.all([
      getTimetableEditor("timetable", "actor", env),
      getTimetableEditor("timetable", "actor", otherEnv),
    ]);
    expect(first.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "timetable_versions",
          operation: "insert",
        }),
        expect.objectContaining({
          table: "timetable_sessions",
          operation: "insert",
        }),
      ]),
    );
    expect(second.writes).toEqual([]);
  });
  it("passes bindings through creation lookups, slug allocation and editor loading", async () => {
    const { client } = fixture();
    mocks.client.mockImplementation((bindings) => {
      expect(bindings).toBe(env);
      return client;
    });
    const editor = await createTimetable(
      {
        institutionId: "institution",
        programmeId: "programme",
        classGroupId: "cohort",
        academicPeriodId: "period",
        createdBy: "actor",
      },
      env,
    );
    expect(editor.timetable.publicSlug).toBe("fixture");
    expect(mocks.client.mock.calls.length).toBeGreaterThan(6);
  });
  it("preserves duplicate-session replay without another insert", async () => {
    const { client, writes } = fixture();
    mocks.client.mockImplementation((bindings) => {
      expect(bindings).toBe(env);
      return client;
    });
    expect((await createTimetableSession(input, env)).id).toBe("session");
    expect((await createTimetableSession(input, env)).id).toBe("session");
    expect(writes).toEqual([]);
  });
  it("retains overlap validation and scopes updates and deletion to the editable version", async () => {
    const { client, writes } = fixture();
    mocks.client.mockImplementation((bindings) => {
      expect(bindings).toBe(env);
      return client;
    });
    await expect(
      createTimetableSession({ ...input, courseCode: "OTHER" }, env),
    ).rejects.toMatchObject({ code: "TIMETABLE_CONFLICT" });
    await updateTimetableSession({ ...input, sessionId: "session" }, env);
    await deleteTimetableSession(
      { timetableId: "timetable", userId: "actor", sessionId: "session" },
      env,
    );
    expect(writes).toHaveLength(2);
    for (const write of writes)
      expect(write.filters).toEqual([
        ["id", "session"],
        ["timetable_version_id", "draft"],
      ]);
  });
  it("requires academic dates before publication and never invokes the RPC on rejection", async () => {
    const { client } = fixture({ dates: false });
    mocks.client.mockImplementation((bindings) => {
      expect(bindings).toBe(env);
      return client;
    });
    await expect(
      publishTimetable("timetable", "actor", env),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each([
    "TIMETABLE_EMPTY",
    "TIMETABLE_CONFLICT",
    "TIMETABLE_VERSION_NOT_DRAFT",
  ])("retains the guarded publication RPC failure %s", async (rpcError) => {
    const { client } = fixture({ rpcError });
    mocks.client.mockImplementation((bindings) => {
      expect(bindings).toBe(env);
      return client;
    });
    await expect(
      publishTimetable("timetable", "actor", env),
    ).rejects.toMatchObject({ code: "PUBLISH_FAILED", status: 422 });
    expect(client.rpc).toHaveBeenCalledWith("publish_timetable_version", {
      p_timetable_id: "timetable",
      p_version_id: "draft",
      p_published_by: "actor",
    });
  });
});
