// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminClient: vi.fn() }));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: mocks.adminClient,
}));

import { getCalendarRevision } from "../server/calendarRevisionRepository";

const timetableId = "10000000-0000-4000-8000-000000000001";
const versionId = "10000000-0000-4000-8000-000000000002";
const env = { SUPABASE_URL: "https://revision-fixture.invalid" };
const timestamp = "2026-10-25T10:26:53.000Z";
type Result = { data: unknown; error: unknown };

function fixture(beforeTimetableRead?: () => Promise<void>) {
  const state = {
    timetable: {
      data: {
        id: timetableId,
        current_published_version_id: versionId,
        updated_at: timestamp,
      },
      error: null,
    } as Result,
    clock: {
      data: { timetable_id: timetableId, revision: 42, updated_at: timestamp },
      error: null,
    } as Result,
    legacyCorrections: [] as Record<string, unknown>[],
  };
  const reads: Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
  }> = [];
  const client = {
    from(table: string) {
      const query = {
        table,
        columns: "",
        filters: [] as Array<[string, unknown]>,
      };
      async function result(): Promise<Result> {
        reads.push(query);
        if (table === "timetables") {
          await beforeTimetableRead?.();
          return state.timetable;
        }
        if (table === "google_calendar_delivery_revisions") return state.clock;
        // Valid legacy responses expose row-count fallback without a mock error.
        if (table === "timetable_versions")
          return {
            data: {
              version_number: 1,
              published_at: timestamp,
              created_at: timestamp,
            },
            error: null,
          };
        if (table === "timetable_correction_directives")
          return { data: state.legacyCorrections, error: null };
        if (table === "timetable_session_exceptions")
          return { data: [], error: null };
        throw new Error(`Unexpected revision table ${table}`);
      }
      const chain = {
        select(columns: string) {
          query.columns = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return chain;
        },
        maybeSingle: result,
        single: result,
        then(resolve: (value: Result) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client, state, reads };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("calendar revision durable authority", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the durable revision instead of reconstructing it from source row counts", async () => {
    const data = fixture();
    mocks.adminClient.mockReturnValue(data.client);

    expect(await getCalendarRevision(timetableId, env)).toEqual({
      sequence: 42,
      updatedAt: timestamp,
      publishedVersionId: versionId,
    });
    expect(data.reads.map((read) => read.table)).toEqual([
      "timetables",
      "google_calendar_delivery_revisions",
    ]);
    expect(data.reads[0].filters).toEqual([["id", timetableId]]);
    expect(data.reads[1].filters).toEqual([["timetable_id", timetableId]]);
    expect(
      data.reads[1].columns.split(",").map((column) => column.trim()),
    ).toEqual(expect.arrayContaining(["revision", "updated_at"]));
  });

  it.each([1, 2147483647])(
    "accepts RFC sequence boundary %s",
    async (revision) => {
      const data = fixture();
      data.state.clock.data = { revision, updated_at: timestamp };
      mocks.adminClient.mockReturnValue(data.client);

      expect(await getCalendarRevision(timetableId, env)).toEqual({
        sequence: revision,
        updatedAt: timestamp,
        publishedVersionId: versionId,
      });
    },
  );

  it("normalizes the authority timestamp to ISO UTC without consulting newer legacy timestamps", async () => {
    const data = fixture();
    data.state.clock.data = {
      revision: 42,
      updated_at: "2026-10-25T12:26:53.123+02:00",
    };
    data.state.legacyCorrections = [{ created_at: "2099-01-01T00:00:00Z" }];
    mocks.adminClient.mockReturnValue(data.client);

    expect(await getCalendarRevision(timetableId, env)).toEqual({
      sequence: 42,
      updatedAt: "2026-10-25T10:26:53.123Z",
      publishedVersionId: versionId,
    });
    expect(data.reads.map((read) => read.table)).toEqual([
      "timetables",
      "google_calendar_delivery_revisions",
    ]);
  });

  it("observes pause and undo advances within one second without a new published version or correction row", async () => {
    const data = fixture();
    mocks.adminClient.mockReturnValue(data.client);
    const changes = [
      { revision: 42, updated_at: "2026-10-25T10:26:53.100Z" },
      { revision: 43, updated_at: "2026-10-25T10:26:53.200Z" },
      { revision: 44, updated_at: "2026-10-25T10:26:53.300Z" },
    ];
    const results = [];
    for (const clock of changes) {
      data.state.clock.data = clock;
      results.push(await getCalendarRevision(timetableId, env));
    }

    expect(results).toEqual(
      changes.map((clock) => ({
        sequence: clock.revision,
        updatedAt: clock.updated_at,
        publishedVersionId: versionId,
      })),
    );
    expect(data.state.timetable.data).toMatchObject({
      current_published_version_id: versionId,
    });
    expect(data.state.legacyCorrections).toEqual([]);
    expect(data.reads).toHaveLength(6);
    expect(
      data.reads.every((read) =>
        ["timetables", "google_calendar_delivery_revisions"].includes(
          read.table,
        ),
      ),
    ).toBe(true);
  });

  it("returns a stable clock for no-op reads even if legacy correction counts change", async () => {
    const data = fixture();
    mocks.adminClient.mockReturnValue(data.client);
    const first = await getCalendarRevision(timetableId, env);
    data.state.legacyCorrections = [
      { created_at: timestamp, revoked_at: timestamp },
      { created_at: timestamp, superseded_at: timestamp },
    ];

    expect(await getCalendarRevision(timetableId, env)).toEqual(first);
    expect(first).toEqual({
      sequence: 42,
      updatedAt: timestamp,
      publishedVersionId: versionId,
    });
  });

  it.each([
    ["missing timetable", null],
    [
      "unpublished timetable",
      { id: timetableId, current_published_version_id: null },
    ],
  ])(
    "rejects %s with 404 before reading the clock",
    async (_label, timetable) => {
      const data = fixture();
      data.state.timetable.data = timetable;
      mocks.adminClient.mockReturnValue(data.client);

      await expect(getCalendarRevision(timetableId, env)).rejects.toMatchObject(
        {
          code: "TIMETABLE_NOT_PUBLISHED",
          status: 404,
        },
      );
      expect(data.reads.map((read) => read.table)).toEqual(["timetables"]);
    },
  );

  it.each([
    ["missing row", null],
    ["empty row", {}],
    ["missing revision", { updated_at: timestamp }],
    ["missing timestamp", { revision: 42 }],
  ])(
    "fails closed with 503 for %s instead of falling back to row counts",
    async (_label, clock) => {
      const data = fixture();
      data.state.clock.data = clock;
      mocks.adminClient.mockReturnValue(data.client);

      await expect(getCalendarRevision(timetableId, env)).rejects.toMatchObject(
        {
          status: 503,
        },
      );
      expect(data.reads.map((read) => read.table)).toEqual([
        "timetables",
        "google_calendar_delivery_revisions",
      ]);
    },
  );

  it.each(
    [
      null,
      undefined,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2147483648,
      Number.MAX_SAFE_INTEGER + 1,
      "",
      "not-a-revision",
      true,
      [],
      [42],
      {},
    ].map((revision) => ({ revision })),
  )("rejects invalid revision metadata %# with 503", async ({ revision }) => {
    const data = fixture();
    data.state.clock.data = { revision, updated_at: timestamp };
    mocks.adminClient.mockReturnValue(data.client);

    await expect(getCalendarRevision(timetableId, env)).rejects.toMatchObject({
      status: 503,
    });
  });

  it.each([null, undefined, "", "not-a-date", 0, false, {}])(
    "rejects invalid timestamp metadata %# with 503",
    async (updatedAt) => {
      const data = fixture();
      data.state.clock.data = { revision: 42, updated_at: updatedAt };
      mocks.adminClient.mockReturnValue(data.client);

      await expect(getCalendarRevision(timetableId, env)).rejects.toMatchObject(
        {
          status: 503,
        },
      );
    },
  );

  it.each(["timetable", "clock"] as const)(
    "fails closed and does not expose private database diagnostics on %s errors",
    async (target) => {
      const data = fixture();
      const privateDiagnostic = "fixture-private-diagnostic-do-not-expose";
      data.state[target].error = {
        message: privateDiagnostic,
        details: privateDiagnostic,
        hint: privateDiagnostic,
      };
      mocks.adminClient.mockReturnValue(data.client);

      const failure = await getCalendarRevision(timetableId, env).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ status: 503 });
      expect(String(failure)).not.toContain(privateDiagnostic);
      expect(JSON.stringify(failure)).not.toContain(privateDiagnostic);
      expect(data.reads.map((read) => read.table)).toEqual(
        target === "timetable"
          ? ["timetables"]
          : ["timetables", "google_calendar_delivery_revisions"],
      );
    },
  );

  it("keeps concurrent request bindings isolated through timetable and durable clock reads", async () => {
    const entered = gate();
    const resume = gate();
    const first = fixture(async () => {
      entered.release();
      await resume.promise;
    });
    const second = fixture();
    const secondVersionId = "10000000-0000-4000-8000-000000000003";
    second.state.timetable.data = {
      id: timetableId,
      current_published_version_id: secondVersionId,
    };
    const secondEnv = Object.freeze({
      SUPABASE_URL: "https://other-revision.invalid",
    });
    second.state.clock.data = {
      revision: 99,
      updated_at: "2026-10-25T11:00:00Z",
    };
    mocks.adminClient.mockImplementation((bindings) => {
      if (bindings === env) return first.client;
      expect(bindings === secondEnv).toBe(true);
      return second.client;
    });
    const firstRequest = getCalendarRevision(timetableId, env);
    const settled = Promise.allSettled([firstRequest]);
    try {
      const paused = await Promise.race([
        entered.promise.then(() => true),
        settled.then(() => false),
      ]);
      expect(paused).toBe(true);
      expect(await getCalendarRevision(timetableId, secondEnv)).toEqual({
        sequence: 99,
        updatedAt: "2026-10-25T11:00:00.000Z",
        publishedVersionId: secondVersionId,
      });
      resume.release();
      expect(await firstRequest).toEqual({
        sequence: 42,
        updatedAt: timestamp,
        publishedVersionId: versionId,
      });
      for (const request of [first, second]) {
        expect(request.reads.map((read) => read.table)).toEqual([
          "timetables",
          "google_calendar_delivery_revisions",
        ]);
        expect(request.reads[1].filters).toEqual([
          ["timetable_id", timetableId],
        ]);
      }
      expect(
        mocks.adminClient.mock.calls.some(([bindings]) => bindings === env),
      ).toBe(true);
      expect(
        mocks.adminClient.mock.calls.some(
          ([bindings]) => bindings === secondEnv,
        ),
      ).toBe(true);
    } finally {
      resume.release();
      await settled;
    }
  });
});
