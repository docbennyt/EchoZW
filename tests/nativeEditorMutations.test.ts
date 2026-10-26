// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "class_rep",
  active: true,
  assigned: true,
  envs: [] as unknown[],
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rows: [] as Record<string, unknown>[],
  failure: "",
}));
const timetableId = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const itemId = "fc76959e-a721-4d47-9a38-4aef351aa6e9";
const key = "14d6e967-cec8-47ec-9ce8-bd054601ec01";
const stamp = "2026-10-23T00:00:00.000Z";
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
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.calls.push({ name, args });
        if (state.failure === name)
          return { data: null, error: { code: "40001" } };
        if (name.includes("fingerprint"))
          return { data: "fingerprint-fixture", error: null };
        if (name.startsWith("dedupe_"))
          return { data: { keptId: itemId, revokedCount: 2 }, error: null };
        return {
          data: {
            id: itemId,
            ...(args.p_payload as object),
            supersedes_id: args.p_correction_id ?? args.p_exception_id,
            updated_at: stamp,
          },
          error: null,
        };
      },
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        let write: Record<string, unknown> | undefined;
        const result = (single = false) => {
          if (write) {
            if (state.failure === table)
              return {
                data: null,
                error: { code: "503", message: "private-database-detail" },
              };
            state.calls.push({ name: table, args: write });
            return {
              data: { id: itemId, created_at: stamp, ...write },
              error: null,
            };
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
                : state.rows;
          const found = rows.filter((row) =>
            filters.every(([k, v]) => row[k as keyof typeof row] === v),
          );
          return { data: single ? (found[0] ?? null) : found, error: null };
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
            write = row;
            return chain;
          },
          update: (row: Record<string, unknown>) => {
            write = row;
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
import { handleEditorMutations } from "../worker/editorMutations.mjs";
const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SECRET_KEY: "fixture-only",
};
const correction = {
  action: "remove",
  sourceMayReplace: false,
  stableSessionKey: "class-1",
  reason: "Cancelled",
};
const exception = {
  exceptionDate: "2026-10-23",
  exceptionType: "cancelled",
  stableSessionKey: "class-1",
  reason: "Cancelled",
};
function dispatch(
  route: string,
  method = "POST",
  body: unknown = {},
  headers: Record<string, string> = {},
  config = env,
) {
  return handleEditorMutations(
    new Request(
      `https://preview.example/api/admin/timetables/${timetableId}/${route}`,
      {
        method,
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
          "idempotency-key": key,
          ...headers,
        },
        body:
          method === "GET"
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
      },
    ),
    config,
  );
}
async function request(...args: Parameters<typeof dispatch>) {
  const response = await dispatch(...args);
  expect(response).not.toBeNull();
  return response!;
}
describe("native editor mutation transport with shared repositories", () => {
  beforeEach(() => {
    state.role = "class_rep";
    state.active = true;
    state.assigned = true;
    state.envs = [];
    state.calls = [];
    state.rows = [];
    state.failure = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected remote I/O");
      }),
    );
  });
  it.each(["corrections", "exceptions"])(
    "edits %s through the existing replacement RPC and audit",
    async (kind) => {
      const response = await request(`${kind}/${itemId}`, "PATCH", {
        ...(kind === "corrections" ? correction : exception),
        expectedUpdatedAt: stamp,
        actor: { user: { id: "attacker" } },
        timetableId: "foreign",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        mutationOutcome: "updated",
        googleCalendarSync: { skipped: true, succeeded: 0 },
      });
      expect(
        state.calls.find((c) => c.name.startsWith("replace_"))?.args,
      ).toMatchObject({
        p_timetable_id: timetableId,
        p_actor_user_id: "user-1",
        p_mutation_key: key,
        p_expected_updated_at: stamp,
      });
      expect(state.calls.some((c) => c.name === "audit_logs")).toBe(true);
      expect(state.envs.every((e) => e === env)).toBe(true);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["corrections", "exceptions"])(
    "creates and replays %s with audited idempotency",
    async (kind) => {
      const payload = kind === "corrections" ? correction : exception;
      const first = await request(kind, "POST", payload);
      expect(first.status).toBe(201);
      state.rows = [
        {
          id: itemId,
          timetable_id: timetableId,
          creator_staff_user_id: "staff-1",
          mutation_key: key,
          semantic_fingerprint: "fingerprint-fixture",
        },
      ];
      const replay = await request(kind, "POST", payload);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        mutationOutcome: "replayed",
        googleCalendarSync: { skipped: true },
      });
      expect(
        state.calls.filter(
          (c) =>
            c.name ===
            (kind === "corrections"
              ? "timetable_correction_directives"
              : "timetable_session_exceptions"),
        ),
      ).toHaveLength(1);
      expect(state.envs.every((e) => e === env)).toBe(true);
    },
  );
  it.each(["corrections", "exceptions"])(
    "removes, restores and deduplicates %s",
    async (kind) => {
      state.rows = [
        {
          id: itemId,
          timetable_id: timetableId,
          active: true,
          updated_at: stamp,
        },
      ];
      expect((await request(`${kind}/${itemId}`, "DELETE")).status).toBe(200);
      state.rows = [
        {
          id: itemId,
          timetable_id: timetableId,
          active: false,
          updated_at: stamp,
          revoked_at: new Date().toISOString(),
        },
      ];
      expect(
        (
          await request(`${kind}/${itemId}`, "POST", {
            expectedUpdatedAt: stamp,
          })
        ).status,
      ).toBe(200);
      const dedupe = await request(`${kind}/dedupe`, "POST", {
        semanticFingerprint: "fingerprint-fixture",
      });
      expect(await dedupe.json()).toMatchObject({
        dedupeResult: { keptId: itemId, revokedCount: 2 },
        googleCalendarSync: { skipped: true },
      });
      expect(state.calls.filter((c) => c.name === "audit_logs")).toHaveLength(
        3,
      );
      expect(state.envs.every((e) => e === env)).toBe(true);
    },
  );
  it.each(["corrections", "exceptions"])(
    "preserves stale edit errors for %s",
    async (kind) => {
      state.failure =
        kind === "corrections"
          ? "replace_timetable_correction_update"
          : "replace_timetable_exception_update";
      const response = await request(`${kind}/${itemId}`, "PATCH", {
        ...(kind === "corrections" ? correction : exception),
        expectedUpdatedAt: stamp,
      });
      expect(response.status).toBe(409);
      expect(state.calls.some((c) => c.name === "audit_logs")).toBe(false);
    },
  );
  it.each([
    ["foreign origin", { origin: "https://evil.example" }, 403],
    ["null origin", { origin: "null" }, 403],
    ["cross-site", { "sec-fetch-site": "cross-site" }, 403],
    ["missing bearer", { authorization: "" }, 401],
    ["bad bearer", { authorization: "Bearer invalid" }, 401],
    ["bad key", { "idempotency-key": "bad" }, 422],
    ["blank key", { "idempotency-key": " " }, 422],
    ["media type", { "content-type": "text/plain" }, 415],
  ])("rejects %s without mutations", async (_name, headers, status) => {
    const response = await request("exceptions", "POST", exception, headers);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.calls).toEqual([]);
  });
  it.each(["unassigned", "inactive", "unknown", "superadmin"])(
    "denies %s staff",
    async (mode) => {
      if (mode === "unassigned") state.assigned = false;
      else if (mode === "inactive") state.active = false;
      else state.role = mode;
      expect((await request(`corrections/${itemId}`, "DELETE")).status).toBe(
        403,
      );
      expect(state.calls).toEqual([]);
    },
  );
  it("allows operational admins", async () => {
    state.role = "admin";
    state.assigned = false;
    expect((await request("exceptions", "POST", exception)).status).toBe(201);
  });
  it.each(["corrections", "exceptions"])(
    "keeps foreign item IDs scoped for %s",
    async (kind) => {
      state.rows = [
        { id: itemId, timetable_id: "another-timetable", active: true },
      ];
      const response = await request(`${kind}/${itemId}`, "DELETE");
      expect(response.status).toBe(404);
      expect(state.calls).toEqual([]);
    },
  );
  it("checks the timetable assignment from the URL", async () => {
    const response = await handleEditorMutations(
      new Request(
        `https://preview.example/api/admin/timetables/${key}/exceptions`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer valid",
            "content-type": "application/json",
          },
          body: JSON.stringify(exception),
        },
      ),
      env,
    );
    expect(response?.status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it.each(["corrections", "exceptions"])(
    "preserves key reuse rejection and semantic dedupe for %s",
    async (kind) => {
      const payload = kind === "corrections" ? correction : exception;
      state.rows = [
        {
          id: itemId,
          timetable_id: timetableId,
          creator_staff_user_id: "staff-1",
          mutation_key: key,
          semantic_fingerprint: "different-content",
          active: true,
        },
      ];
      expect((await request(kind, "POST", payload)).status).toBe(409);
      state.rows = [
        {
          id: itemId,
          timetable_id: timetableId,
          semantic_fingerprint: "fingerprint-fixture",
          active: true,
        },
      ];
      const duplicate = await request(kind, "POST", payload);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({
        mutationOutcome: "already_exists",
        googleCalendarSync: { skipped: true },
      });
      expect(state.calls.filter((c) => c.name === "audit_logs")).toHaveLength(
        1,
      );
      expect(state.envs.every((e) => e === env)).toBe(true);
    },
  );
  it.each(["corrections", "exceptions"])(
    "replays item edits only for the original item in %s",
    async (kind) => {
      const payload = {
        ...(kind === "corrections" ? correction : exception),
        expectedUpdatedAt: stamp,
      };
      state.rows = [
        {
          id: key,
          timetable_id: timetableId,
          creator_staff_user_id: "staff-1",
          mutation_key: key,
          semantic_fingerprint: "fingerprint-fixture",
          supersedes_id: itemId,
        },
      ];
      const replay = await request(`${kind}/${itemId}`, "PATCH", payload);
      expect(await replay.json()).toMatchObject({
        mutationOutcome: "replayed",
      });
      expect((await request(`${kind}/${key}`, "PATCH", payload)).status).toBe(
        409,
      );
      expect(state.calls.some((c) => c.name.startsWith("replace_"))).toBe(
        false,
      );
      expect(state.envs.every((e) => e === env)).toBe(true);
    },
  );
  it.each([
    ["stale", { updated_at: "2026-10-22T00:00:00.000Z" }, "UNDO_CONFLICT"],
    ["superseded", { replaced_by_id: key }, "UNDO_CONFLICT"],
    [
      "expired",
      { revoked_at: "2020-01-01T00:00:00.000Z" },
      "UNDO_WINDOW_EXPIRED",
    ],
    ["active", { active: true }, "UPDATE_ALREADY_ACTIVE"],
  ])("preserves %s undo protection", async (_name, overrides, code) => {
    state.rows = [
      {
        id: itemId,
        timetable_id: timetableId,
        active: false,
        updated_at: stamp,
        revoked_at: new Date().toISOString(),
        ...overrides,
      },
    ];
    const response = await request(`corrections/${itemId}`, "POST", {
      expectedUpdatedAt: stamp,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(state.calls).toEqual([]);
  });
  it("does not report success when the repository audit fails", async () => {
    state.failure = "audit_logs";
    const response = await request("exceptions", "POST", exception);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-database-detail");
  });
  it.each([
    ["exceptions", "POST", { ...exception, reason: "" }],
    ["exceptions", "POST", { ...exception, exceptionDate: "bad" }],
    [`exceptions/${itemId}`, "PATCH", exception],
    [`corrections/${itemId}`, "POST", { expectedUpdatedAt: "bad" }],
    ["exceptions/dedupe", "POST", { semanticFingerprint: "short" }],
  ])("rejects invalid mutation contracts %#", async (route, method, body) => {
    expect((await request(route, method, body)).status).toBe(422);
    expect(state.calls).toEqual([]);
  });
  it.each(["{", " ".repeat(16385)])(
    "rejects malformed or oversized body %#",
    async (body) => {
      expect((await request("exceptions", "POST", body)).status).toBe(
        body.length > 16384 ? 413 : 422,
      );
      expect(state.calls).toEqual([]);
    },
  );
  it("bounds actual streamed UTF-8 bytes even when content-length understates them", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...exception, notes: "\u00e9".repeat(9000) }),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8000));
        controller.enqueue(bytes.slice(8000));
        controller.close();
      },
    });
    const response = await handleEditorMutations(
      new Request(
        `https://preview.example/api/admin/timetables/${timetableId}/exceptions`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer valid",
            "content-type": "application/json",
            "content-length": "2",
          },
          body: stream,
          duplex: "half",
        } as RequestInit,
      ),
      env,
    );
    expect(response?.status).toBe(413);
    expect(state.calls).toEqual([]);
  });
  it("accepts legacy saves without a key and DELETE without a JSON body", async () => {
    const saved = await handleEditorMutations(
      new Request(
        `https://preview.example/api/admin/timetables/${timetableId}/exceptions`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer valid",
            "content-type": "application/json",
          },
          body: JSON.stringify(exception),
        },
      ),
      env,
    );
    expect(saved?.status).toBe(201);
    const inserted = state.calls.find(
      (c) => c.name === "timetable_session_exceptions",
    );
    expect(inserted?.args.mutation_key).toMatch(/^[0-9a-f-]{36}$/);
    state.rows = [{ id: itemId, timetable_id: timetableId, active: true }];
    const removed = await handleEditorMutations(
      new Request(
        `https://preview.example/api/admin/timetables/${timetableId}/exceptions/${itemId}`,
        {
          method: "DELETE",
          headers: { authorization: "Bearer valid" },
        },
      ),
      env,
    );
    expect(removed?.status).toBe(200);
  });
  it.each(["corrections", "exceptions"])(
    "accepts an empty transport stream for bodyless %s DELETE",
    async (collection) => {
      state.rows = [{ id: itemId, timetable_id: timetableId, active: true }];
      const response = await handleEditorMutations(
        new Request(
          `https://preview.example/api/admin/timetables/${timetableId}/${collection}/${itemId}`,
          {
            method: "DELETE",
            headers: { authorization: "Bearer valid" },
            body: new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            duplex: "half",
          } as RequestInit,
        ),
        env,
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("cache-control")).toBe("no-store");
    },
  );
  it.each([undefined, "text/plain"])(
    "rejects nonempty DELETE without JSON media type: %s",
    async (contentType) => {
      state.rows = [{ id: itemId, timetable_id: timetableId, active: true }];
      const headers = new Headers({ authorization: "Bearer valid" });
      if (contentType) headers.set("content-type", contentType);
      const response = await handleEditorMutations(
        new Request(
          `https://preview.example/api/admin/timetables/${timetableId}/corrections/${itemId}`,
          {
            method: "DELETE",
            headers,
            body: new TextEncoder().encode("{}"),
          },
        ),
        env,
      );
      expect(response?.status).toBe(415);
      expect(state.calls).toEqual([]);
    },
  );
  it("keeps simultaneous environments isolated", async () => {
    const other = { ...env, SUPABASE_SECRET_KEY: "other-fixture" };
    const responses = await Promise.all([
      request("exceptions", "POST", exception),
      request(
        "exceptions/dedupe",
        "POST",
        { semanticFingerprint: "fingerprint-fixture" },
        {},
        other,
      ),
    ]);
    expect(responses.every((r) => r.status < 300)).toBe(true);
    expect(state.envs.filter((e) => e === other).length).toBeGreaterThan(3);
    expect(state.envs.every((e) => e === env || e === other)).toBe(true);
  });
  it("returns null for routes owned elsewhere and 405 for unsupported methods", async () => {
    expect((await request("corrections", "GET")).status).toBe(200);
    expect(await dispatch("pauses")).toBeNull();
    expect(await dispatch("exceptions/not-an-id", "DELETE")).toBeNull();
    const response = await request("exceptions", "PATCH");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(state.calls).toEqual([]);
  });
});
