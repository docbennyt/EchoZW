// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "class_rep",
  active: true,
  assigned: true,
  failure: false,
  rows: [] as Record<string, unknown>[],
  writes: [] as Record<string, unknown>[],
  envs: [] as unknown[],
}));
const timetableId = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const key = "fc76959e-a721-4d47-9a38-4aef351aa6e9";
vi.mock("../server/supabase/userClient.js", () => ({
  createSupabaseUserClient: (_token: string, env: unknown) => {
    state.envs.push(env);
    return {
      auth: {
        getUser: async (token: string) => ({
          data: { user: token === "valid" ? { id: "user-1" } : null },
          error: null,
        }),
      },
    };
  },
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: (env: unknown) => {
    state.envs.push(env);
    return {
      rpc: async () => ({
        data: "fingerprint-fixture",
        error: state.failure ? {} : null,
      }),
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        let inserted: Record<string, unknown> | undefined;
        const result = (single = false) => {
          if (inserted) {
            const row = {
              id: "correction-1",
              created_at: "2026-10-23T00:00:00Z",
              ...inserted,
            };
            state.writes.push({ table, ...inserted });
            if (table === "timetable_correction_directives")
              state.rows.push(row);
            return { data: row, error: null };
          }
          const rows =
            table === "staff_users"
              ? [
                  {
                    id: "staff-1",
                    user_id: "user-1",
                    role: state.role,
                    active: state.active,
                  },
                ]
              : table === "class_rep_assignments"
                ? state.assigned
                  ? [
                      {
                        id: "assignment-1",
                        staff_user_id: "staff-1",
                        timetable_id: timetableId,
                        active: true,
                        timetables: {},
                      },
                    ]
                  : []
                : table === "timetable_correction_directives"
                  ? state.rows
                  : [];
          const data = rows.filter((row) =>
            filters.every(
              ([k, v]) => (row as Record<string, unknown>)[k] === v,
            ),
          );
          return {
            data: single ? (data[0] ?? null) : data,
            error: state.failure ? {} : null,
          };
        };
        const chain = {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          eq: (k: string, v: unknown) => {
            filters.push([k, v]);
            return chain;
          },
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return chain;
          },
          maybeSingle: async () => result(true),
          single: async () => result(true),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve),
        };
        return chain;
      },
    };
  },
}));
import worker from "../worker/index.mjs";
const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SECRET_KEY: "fixture-only",
  VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public",
};
const path = `/api/admin/timetables/${timetableId}/corrections`;
const payload = {
  action: "remove",
  sourceMayReplace: false,
  stableSessionKey: "class-1",
  reason: "Cancelled",
};
function request(
  method = "GET",
  body?: string,
  headers: Record<string, string> = {},
  route = path,
  config = env,
) {
  return worker.fetch(
    new Request(`https://preview.example${route}`, {
      method,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": key,
        ...headers,
      },
      body,
    }),
    config,
    { waitUntil: () => {} },
  );
}
describe("native recurring correction collection", () => {
  beforeEach(() => {
    state.role = "class_rep";
    state.active = true;
    state.assigned = true;
    state.failure = false;
    state.rows = [];
    state.writes = [];
    state.envs = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected remote I/O");
      }),
    );
  });
  it("lists the assigned timetable through the real repository", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      corrections: { corrections: [], exceptions: [] },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.envs.every((value) => value === env)).toBe(true);
  });
  it("creates, audits and replays without Google propagation", async () => {
    const first = await request(
      "POST",
      JSON.stringify({
        ...payload,
        actor: { user: { id: "attacker" } },
        timetableId: "other",
      }),
    );
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      mutationOutcome: "created",
      googleCalendarSync: { skipped: true },
    });
    const replay = await request("POST", JSON.stringify(payload));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ mutationOutcome: "replayed" });
    expect(
      state.writes.filter(
        (row) => row.table === "timetable_correction_directives",
      ),
    ).toEqual([
      expect.objectContaining({
        timetable_id: timetableId,
        creator_user_id: "user-1",
        mutation_key: key,
      }),
    ]);
    expect(state.writes.some((row) => row.table === "audit_logs")).toBe(true);
    expect(state.envs.length).toBeGreaterThan(5);
    expect(state.envs.every((value) => value === env)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not expose inactive corrections or another timetable's rows", async () => {
    state.rows = [
      { id: "visible", timetable_id: timetableId, active: true },
      { id: "revoked", timetable_id: timetableId, active: false },
      { id: "foreign", timetable_id: "another-timetable", active: true },
    ];
    const body = await (await request()).json();
    expect(
      body.corrections.corrections.map((row: { id: string }) => row.id),
    ).toEqual(["visible"]);
  });
  it("rejects attempts to use a key for different content", async () => {
    state.rows = [
      {
        id: "original",
        timetable_id: timetableId,
        creator_staff_user_id: "staff-1",
        mutation_key: key,
        semantic_fingerprint: "different-original-content",
        active: true,
      },
    ];
    const response = await request("POST", JSON.stringify(payload));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(state.writes).toEqual([]);
  });
  it("returns an existing semantic duplicate for a fresh save key", async () => {
    await request("POST", JSON.stringify(payload));
    const response = await request("POST", JSON.stringify(payload), {
      "idempotency-key": "14d6e967-cec8-47ec-9ce8-bd054601ec01",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mutationOutcome: "already_exists",
    });
    expect(
      state.writes.filter(
        (row) => row.table === "timetable_correction_directives",
      ),
    ).toHaveLength(1);
  });
  it("keeps simultaneous request configurations isolated through repository I/O", async () => {
    const otherEnv = { ...env, SUPABASE_SECRET_KEY: "other-fixture" };
    const responses = await Promise.all([
      request("POST", JSON.stringify(payload)),
      request("POST", JSON.stringify(payload), {}, path, otherEnv),
    ]);
    expect(responses.every((response) => response.status < 300)).toBe(true);
    expect(state.envs.filter((value) => value === env).length).toBeGreaterThan(
      5,
    );
    expect(
      state.envs.filter((value) => value === otherEnv).length,
    ).toBeGreaterThan(5);
    expect(
      state.envs.every((value) => value === env || value === otherEnv),
    ).toBe(true);
  });
  it("checks the requested timetable assignment even when another is assigned", async () => {
    const foreign = path.replace(
      timetableId,
      "b603dce8-ed8f-4aea-91de-09d4e1124f9a",
    );
    expect(
      (await request("POST", JSON.stringify(payload), {}, foreign)).status,
    ).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it("preserves repository validation of recurring class times", async () => {
    const response = await request(
      "POST",
      JSON.stringify({
        ...payload,
        action: "add",
        courseCode: "CS101",
        courseName: "Computing",
        weekday: 1,
        startTime: "12:00",
        endTime: "11:00",
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_TIME_RANGE" },
    });
    expect(state.writes).toEqual([]);
  });
  it.each([
    ["missing bearer", { authorization: "" }, 401],
    ["invalid bearer", { authorization: "Bearer invalid" }, 401],
    ["foreign origin", { origin: "https://evil.example" }, 403],
    ["null origin", { origin: "null" }, 403],
    ["cross-site metadata", { "sec-fetch-site": "cross-site" }, 403],
  ])("rejects %s without writes", async (_name, headers, status) => {
    expect(
      (await request("POST", JSON.stringify(payload), headers)).status,
    ).toBe(status);
    expect(state.writes).toEqual([]);
  });
  it.each(["unassigned", "inactive", "ordinary", "non-founder"])(
    "denies %s staff",
    async (mode) => {
      if (mode === "unassigned") state.assigned = false;
      if (mode === "inactive") state.active = false;
      if (mode === "ordinary") state.role = "unknown";
      if (mode === "non-founder") state.role = "superadmin";
      expect((await request("POST", JSON.stringify(payload))).status).toBe(403);
      expect(state.writes).toEqual([]);
    },
  );
  it("allows the request origin and operational admins without assignments", async () => {
    state.role = "admin";
    state.assigned = false;
    expect(
      (
        await request("POST", JSON.stringify(payload), {
          origin: "https://preview.example",
        })
      ).status,
    ).toBe(201);
  });
  it.each([
    ["{", {}, 422],
    [JSON.stringify({ ...payload, reason: "" }), {}, 422],
    [JSON.stringify(payload), { "idempotency-key": "bad" }, 422],
    [JSON.stringify(payload), { "idempotency-key": " " }, 422],
    [JSON.stringify(payload), { "content-type": "text/plain" }, 415],
    [" ".repeat(16385), {}, 413],
  ])("rejects invalid input %#", async (body, headers, status) => {
    expect((await request("POST", body, headers)).status).toBe(status);
    expect(state.writes).toEqual([]);
  });
  it("fails closed on authorization database failure", async () => {
    state.failure = true;
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("fixture-only");
    expect(state.writes).toEqual([]);
  });
  it("keeps unsupported methods and adjacent routes closed", async () => {
    const response = await request("DELETE");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(
      (await request("POST", "{}", {}, `${path}/correction-1`)).status,
    ).toBe(503);
    expect(
      (
        await request(
          "POST",
          "{}",
          {},
          path.replace("corrections", "exceptions"),
        )
      ).status,
    ).toBe(503);
    expect(state.writes).toEqual([]);
  });
});
