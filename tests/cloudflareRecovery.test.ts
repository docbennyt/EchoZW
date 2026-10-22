import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Base64Url } from "../src/domain/token.js";

const state = vi.hoisted(() => ({
  role: "admin",
  databaseFailure: false,
  envs: [] as unknown[],
  writes: [] as unknown[],
  subscriptions: [] as Record<string, unknown>[],
  rpcFailure: false,
  queries: [] as string[],
  versionRows: null as Record<string, unknown>[] | null,
  timetableRows: null as Record<string, unknown>[] | null,
}));
const timetableId = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const raw = {
  timetable_version_id: "version-1",
  stable_session_key: "source-wednesday",
  course_code: "ABC101",
  course_name: "Testing",
  weekday: 3,
  start_time: "12:15:00",
  end_time: "13:15:00",
  venue: "N109",
};
const base = {
  id: timetableId,
  public_slug: "test-class",
  current_published_version_id: "version-1",
  institution_id: "institution-1",
  programme_id: "programme-1",
  cohort_id: "cohort-1",
  updated_at: "2026-10-09T12:00:00Z",
  institutions: { name: "Test Institute", timezone: "Africa/Harare" },
  programmes: { name: "Engineering" },
  cohorts: { label: "Part 4.1" },
  academic_periods: {
    name: "Semester 1",
    starts_on: "2026-08-01",
    ends_on: "2026-12-01",
  },
};

vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: (env: Record<string, string>) => {
    if (env?.SUPABASE_SECRET_KEY !== "fixture-secret")
      throw new Error("Worker environment lost");
    state.envs.push(env);
    function query(table: string) {
      state.queries.push(table);
      const filters: Array<[string, unknown]> = [];
      let range: [number, number] = [0, 999];
      const result = (single = false) => {
        const rows: Record<string, unknown[]> = {
          timetables: state.timetableRows ?? [base],
          timetable_versions: state.versionRows ?? [
            {
              id: "version-1",
              timetable_id: timetableId,
              version_number: 1,
              published_at: "2026-08-01T00:00:00Z",
            },
          ],
          timetable_sessions: [raw],
          timetable_correction_directives: [
            {
              id: "remove-1",
              timetable_id: timetableId,
              stable_session_key: "source-wednesday",
              action: "remove",
              active: true,
              created_at: "2026-10-09T12:00:00Z",
            },
            {
              id: "add-1",
              timetable_id: timetableId,
              stable_session_key: "correction-tuesday",
              action: "add",
              active: true,
              course_code: "ABC101",
              course_name: "Testing",
              weekday: 2,
              start_time: "12:15:00",
              end_time: "13:15:00",
              venue: "N109",
              created_at: "2026-10-09T12:00:01Z",
            },
          ],
          calendar_subscriptions: state.subscriptions,
          institutions: [{ id: "institution-1", name: "Test Institute" }],
          programmes: [
            {
              id: "programme-1",
              institution_id: "institution-1",
              name: "Engineering",
            },
          ],
          cohorts: [
            { id: "cohort-1", programme_id: "programme-1", label: "Part 4.1" },
          ],
          academic_periods: [
            {
              id: "period-1",
              institution_id: "institution-1",
              name: "Semester 1",
            },
          ],
          staff_users: [
            {
              id: "staff-1",
              role: state.role,
              active: true,
              user_id: "operator-1",
              is_founder: false,
            },
          ],
          class_rep_assignments: [],
        };
        const filtered = (rows[table] ?? [])
          .filter((row) =>
            filters.every(([column, value]) =>
              Array.isArray(value)
                ? value.includes((row as Record<string, unknown>)[column])
                : (row as Record<string, unknown>)[column] === value,
            ),
          )
          .slice(range[0], range[1] + 1);
        return {
          data: single ? (filtered[0] ?? null) : filtered,
          error: state.databaseFailure ? { message: "unavailable" } : null,
        };
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          filters.push([column, values]);
          return chain;
        },
        range: (start: number, end: number) => {
          range = [start, end];
          return chain;
        },
        not: () => chain,
        order: () => chain,
        or: () => chain,
        lte: () => chain,
        gte: () => chain,
        maybeSingle: async () => result(true),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return chain;
    }
    return {
      from: query,
      rpc: (name: string, input: Record<string, unknown>) => ({
        single: async () => {
          state.writes.push({ name, input });
          if (state.rpcFailure)
            return { data: null, error: { message: "write failed" } };
          const record = {
            id: `subscription-new-${state.subscriptions.length}`,
            calendar_name: "Engineering",
            timetable_id: input.p_timetable_id,
            token_hash: input.p_token_hash,
            anonymous_session_id: input.p_anonymous_session_id,
            reminder_offsets_minutes: input.p_reminder_offsets_minutes,
            revoked_at: null,
          };
          state.subscriptions.push(record);
          return {
            data: record,
            error: null,
          };
        },
      }),
    };
  },
}));
vi.mock("../server/supabase/userClient.js", () => ({
  createSupabaseUserClient: () => ({
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: token === "fixture-access" ? { id: "operator-1" } : null,
        },
        error: null,
      }),
    },
  }),
}));
vi.mock("../server/analyticsRepository.js", () => ({
  recordCalendarFeedActivity: vi.fn().mockResolvedValue(undefined),
}));

// Exercise the actual Worker router, canonical resolver, nested repositories and
// ICS serializer. Only external Supabase I/O is replaced.
import worker from "../worker/index.mjs";

const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SECRET_KEY: "fixture-secret",
  VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public",
  PUBLIC_APP_URL: "https://calender.aido.co.zw",
};
const ctx = {
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
};
const request = (path: string, init?: RequestInit, config = env) =>
  worker.fetch(
    new Request(`https://next.calender.aido.co.zw${path}`, init),
    config,
    ctx,
  );

describe("native recovery with Railway unreachable and no process credentials", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.envs = [];
    state.writes = [];
    state.role = "admin";
    state.databaseFailure = false;
    state.rpcFailure = false;
    state.queries = [];
    state.versionRows = null;
    state.timetableRows = null;
    state.subscriptions = [
      {
        id: "subscription-1",
        timetable_id: timetableId,
        calendar_name: "Test class",
        reminder_offsets_minutes: [],
        revoked_at: null,
        token_hash: await sha256Base64Url("existing-fixture-token"),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network bridge");
      }),
    );
  });

  it("passes Worker credentials through pauses and public settings, preserving raw evidence", async () => {
    const response = await request("/api/public/timetables/test-class");
    expect(response.status).toBe(200);
    const { timetable } = await response.json();
    expect(timetable.sessions).toMatchObject([
      { weekday: 3, stableSessionKey: "source-wednesday" },
    ]);
    expect(timetable.effectiveSessions).toMatchObject([{ weekday: 2 }]);
    expect(state.envs.length).toBeGreaterThanOrEqual(3);
    expect(state.envs.every((value) => value === env)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves the original feed projection and observes stale/current ETags", async () => {
    const response = await request("/calendar/feed/existing-fixture-token.ics");
    expect(response.status).toBe(200);
    const bytes = await response.text();
    expect(bytes).toContain("BYDAY=TU");
    expect(bytes).not.toContain("BYDAY=WE");
    expect(response.headers.get("cache-control")).toContain("private");
    const etag = response.headers.get("etag")!;
    expect(
      (
        await request("/calendar/feed/existing-fixture-token.ics", {
          headers: { "if-none-match": '"old"' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/calendar/feed/existing-fixture-token.ics", {
          headers: { "if-none-match": etag },
        })
      ).status,
    ).toBe(304);
    expect(
      (
        await request("/calendar/feed/existing-fixture-token.ics", {
          method: "HEAD",
        })
      ).status,
    ).toBe(200);
  });

  it("authenticates staff reads and rejects anonymous and Class Rep institution administration", async () => {
    expect(
      (
        await request("/api/admin/session", {
          headers: { authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
    expect((await request("/api/admin/institutions")).status).toBe(401);
    const response = await request("/api/admin/institutions", {
      headers: { authorization: "Bearer fixture-access" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      institutions: [{ name: "Test Institute" }],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    state.role = "class_rep";
    expect(
      (
        await request("/api/admin/institutions", {
          headers: { authorization: "Bearer fixture-access" },
        })
      ).status,
    ).toBe(403);
  });

  it("restores every read required by the admin screen as an authorized complete workflow", async () => {
    for (const [path, key] of [
      ["/api/admin/institutions", "institutions"],
      ["/api/admin/programmes", "programmes"],
      ["/api/admin/class-groups", "classGroups"],
      ["/api/admin/academic-periods", "academicPeriods"],
      ["/api/admin/timetables", "timetables"],
    ]) {
      const response = await request(path, {
        headers: { authorization: "Bearer fixture-access" },
      });
      expect(response.status, path).toBe(200);
      expect((await response.json())[key], path).toHaveLength(1);
    }
    expect(
      state.queries.filter((table) => table === "timetable_versions"),
    ).toHaveLength(1);
    expect(state.queries).not.toContain("timetable_sessions");
    state.role = "class_rep";
    for (const path of [
      "/api/admin/programmes",
      "/api/admin/class-groups",
      "/api/admin/academic-periods",
      "/api/admin/timetables",
    ]) {
      expect(
        (
          await request(path, {
            headers: { authorization: "Bearer fixture-access" },
          })
        ).status,
      ).toBe(403);
    }
  });

  it("loads version summaries beyond the database row cap without misclassifying another timetable", async () => {
    state.timetableRows = [
      base,
      { ...base, id: "second-timetable", public_slug: "second-class" },
    ];
    state.versionRows = Array.from({ length: 1200 }, (_, i) => ({
      id: `history-${i}`,
      timetable_id: timetableId,
      status: "published",
      version_number: 1201 - i,
    }));
    state.versionRows.push({
      id: "second-draft",
      timetable_id: "second-timetable",
      status: "draft",
      version_number: 1,
    });
    const response = await request("/api/admin/timetables", {
      headers: { authorization: "Bearer fixture-access" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).timetables[1].currentDraftVersionId).toBe(
      "second-draft",
    );
    expect(
      state.queries.filter((table) => table === "timetable_versions"),
    ).toHaveLength(3);
    expect(state.queries).not.toContain("timetable_sessions");
  });

  it("creates a durable feed subscription with the existing RPC/token contract", async () => {
    const response = await request("/api/calendar/subscriptions", {
      method: "POST",
      headers: { origin: "https://next.calender.aido.co.zw" },
      body: JSON.stringify({
        timetableId,
        provider: "apple_subscription",
        reminderPreset: "on_time",
      }),
    });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.feedUrl).toMatch(
      /^https:\/\/next.calender.aido.co.zw\/calendar\/feed\/.+\.ics$/,
    );
    expect(result.appleDeepLinkUrl).toMatch(/^webcal:/);
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
    expect(state.writes).toMatchObject([
      {
        name: "create_calendar_subscription_with_profile",
        input: {
          p_timetable_id: timetableId,
          p_provider: "apple_subscription",
          p_token_hash: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(state.writes)).not.toContain(
      result.feedUrl.split("/feed/")[1].split(".ics")[0],
    );
    expect((await request(new URL(result.feedUrl).pathname)).status).toBe(200);
  });

  it("does not retrieve feeds with a wrong token or a revoked original subscription", async () => {
    expect((await request("/calendar/feed/wrong-token.ics")).status).toBe(404);
    state.subscriptions[0].revoked_at = "2026-10-19T00:00:00Z";
    expect(
      (await request("/calendar/feed/existing-fixture-token.ics")).status,
    ).toBe(404);
  });

  it("returns no success or private feed URL after a failed transaction", async () => {
    state.rpcFailure = true;
    const response = await request("/api/calendar/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        timetableId,
        provider: "apple_subscription",
        reminderPreset: "on_time",
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("feedUrl");
    expect(state.subscriptions).toHaveLength(1);
  });

  it("validates secure origin and reminders before committing subscription state", async () => {
    const init = {
      method: "POST",
      body: JSON.stringify({
        timetableId,
        provider: "apple_subscription",
        reminderPreset: "on_time",
      }),
    };
    const insecure = await worker.fetch(
      new Request(
        "http://next.calender.aido.co.zw/api/calendar/subscriptions",
        init,
      ),
      env,
      ctx,
    );
    expect(insecure.status).toBe(503);
    expect(
      (
        await request("/api/calendar/subscriptions", {
          method: "POST",
          body: JSON.stringify({
            timetableId,
            provider: "apple_subscription",
            reminderPreset: "custom",
            customReminderOffsets: [],
          }),
        })
      ).status,
    ).toBe(422);
    expect(state.writes).toHaveLength(0);
  });

  it("rejects cross-origin/oversized input and Google setup before persistence", async () => {
    expect(
      (
        await request("/api/calendar/subscriptions", {
          method: "POST",
          headers: { origin: "https://evil.invalid" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/calendar/subscriptions", {
          method: "POST",
          body: "x".repeat(16385),
        })
      ).status,
    ).toBe(413);
    const response = await request("/api/calendar/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        timetableId,
        provider: "google_api",
        reminderPreset: "on_time",
      }),
    });
    expect(response.status).toBe(503);
    expect(state.writes).toHaveLength(0);
  });

  it("fails closed without configuration or on database failure, never forwarding to Railway", async () => {
    expect(
      (await request("/api/public/timetables", undefined, {} as typeof env))
        .status,
    ).toBe(503);
    state.databaseFailure = true;
    expect((await request("/api/public/timetables")).status).toBe(503);
    expect(
      (await request("/api/admin/unported", { method: "POST" })).status,
    ).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps intake closed and retries existing unprocessed messages without acknowledgement", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const put = vi.fn();
    const send = vi.fn();
    await worker.queue({
      messages: [
        {
          body: { kind: "source_document_uploaded", r2Key: "source.docx" },
          ack,
          retry,
        },
      ],
    });
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    const response = await request(
      "/api/edge/source-documents",
      { method: "POST", headers: { authorization: "Bearer fixture-upload" } },
      {
        ...env,
        EDGE_SOURCE_UPLOAD_SECRET: "fixture-upload",
        SOURCE_BUCKET: { put },
        SOURCE_PROCESSING_QUEUE: { send },
      } as typeof env,
    );
    expect(response.status).toBe(503);
    expect(put).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
