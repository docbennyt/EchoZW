// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  history: [] as Record<string, unknown>[],
  queries: [] as Array<{
    table: string;
    filters: Array<[string, unknown]>;
    orders: string[];
    range?: [number, number];
  }>,
}));
vi.mock("../server/academicPauseRepository.js", () => ({
  listActiveAcademicPausesForTimetable: vi.fn().mockResolvedValue([]),
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const query: (typeof fixture.queries)[number] = {
        table,
        filters: [],
        orders: [],
      };
      fixture.queries.push(query);
      const rows = () =>
        table === "timetables"
          ? [
              {
                id: "timetable-a",
                current_published_version_id: "version-a",
                institution_id: "institution-a",
                programme_id: "programme-a",
                cohort_id: "cohort-a",
              },
            ]
          : table === "timetable_versions"
            ? [{ id: "version-a", version_number: 1 }]
            : table === "timetable_session_exceptions"
              ? fixture.history
                  .filter((row) =>
                    query.filters.every(([key, value]) => row[key] === value),
                  )
                  .slice(query.range?.[0] ?? 0, (query.range?.[1] ?? 999) + 1)
              : [];
      const chain = {
        select: () => chain,
        not: () => chain,
        eq: (key: string, value: unknown) => {
          query.filters.push([key, value]);
          return chain;
        },
        order: (key: string) => {
          query.orders.push(key);
          return chain;
        },
        range: (start: number, end: number) => {
          query.range = [start, end];
          return chain;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));
import { getPublishedTimetableById } from "../server/pilotRepository";
const row = (index: number) => ({
  id: `exception-${String(index).padStart(5, "0")}`,
  timetable_id: "timetable-a",
  active: false,
  exception_type: "extra",
  session_type: "Examination",
  exception_date: "2026-11-10",
  course_code: "QA100",
  course_name: "Fixture exam",
  start_time: "09:00:00",
  end_time: "11:00:00",
  venue: "QA venue",
  created_at: "2026-10-28T12:00:00Z",
});
beforeEach(() => {
  fixture.history = [];
  fixture.queries = [];
});
describe("published examination identity history pagination", () => {
  it("loads an active exam beyond 1000 rows and preserves inactive ancestry from the first page", async () => {
    fixture.history = Array.from({ length: 1002 }, (_, index) => row(index));
    fixture.history[1001] = {
      ...row(1001),
      active: true,
      supersedes_id: row(0).id,
    };
    fixture.history.push({
      ...row(1002),
      timetable_id: "unrelated-timetable",
      active: true,
    });
    const published = await getPublishedTimetableById("timetable-a");
    expect(published.exceptions).toHaveLength(1);
    expect(published.exceptions[0]).toMatchObject({
      id: row(1001).id,
      identityRootId: row(0).id,
      active: true,
    });
    const pages = fixture.queries.filter(
      (query) => query.table === "timetable_session_exceptions",
    );
    expect(pages.map((query) => query.range)).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
    for (const page of pages) {
      expect(page.filters).toEqual([["timetable_id", "timetable-a"]]);
      expect(page.orders).toEqual(["id"]);
    }
  });
  it("fails closed at the bounded history limit instead of returning a truncated published calendar", async () => {
    fixture.history = Array.from({ length: 10001 }, (_, index) => row(index));
    await expect(
      getPublishedTimetableById("timetable-a"),
    ).rejects.toMatchObject({
      code: "EXAM_IDENTITY_HISTORY_LIMIT",
      status: 503,
    });
    const pages = fixture.queries.filter(
      (query) => query.table === "timetable_session_exceptions",
    );
    expect(pages).toHaveLength(20);
    expect(pages.at(-1)?.range).toEqual([9500, 9999]);
  });
});
