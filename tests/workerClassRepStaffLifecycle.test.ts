// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => {
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    ids: {
      actorUser: uuid(1),
      actorStaff: uuid(2),
      repUser: uuid(3),
      rep: uuid(4),
      adminUser: uuid(5),
      admin: uuid(6),
      founderUser: uuid(7),
      founder: uuid(8),
      timetable: uuid(9),
      assignment: uuid(10),
      invitedUser: uuid(11),
      secondTimetable: uuid(12),
    },
    tables: {} as Record<string, Row[]>,
    users: [] as Row[],
    writes: [] as {
      table: string;
      operation: string;
      row: Row;
      filters: Row;
    }[],
    invitations: [] as {
      email: string;
      options: Row;
      env: NodeJS.ProcessEnv;
    }[],
    clients: [] as NodeJS.ProcessEnv[],
    userClients: [] as NodeJS.ProcessEnv[],
    failTable: "",
    failPoint: "",
    rpcCalls: [] as Row[],
    reservedEmails: [] as string[],
    actorAttempts: {} as Record<string, number>,
    next: 100,
  };
});

// Keep authorization, schemas, lifecycle policies, audit and request context real.
// Only the Supabase boundary is synthetic; unexpected network calls fail locally.
vi.mock("../server/supabase/userClient.js", () => ({
  createSupabaseUserClient: (_token: string, env: NodeJS.ProcessEnv) => {
    state.userClients.push(env);
    return {
      auth: {
        getUser: async (token: string) => ({
          data: {
            user:
              token === "fixture-session"
                ? { id: state.ids.actorUser, email: "operator@example.test" }
                : null,
          },
          error: null,
        }),
      },
    };
  },
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: (env: NodeJS.ProcessEnv) => {
    state.clients.push(env);
    return {
      rpc: async (name: string, payload: Row) => {
        expect(name).toBe("czw_staff_lifecycle");
        state.rpcCalls.push({ name, ...payload });
        return lifecycleRpc(payload);
      },
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: state.users },
            error: null,
          }),
          inviteUserByEmail: async (email: string, options: Row) => {
            state.invitations.push({ email, options, env });
            const user = state.users.find((entry) => entry.email === email) ?? {
              id: state.ids.invitedUser,
              email,
            };
            if (!state.users.some((entry) => entry.id === user.id)) {
              state.users.push({ ...user, invited_at: "2026-10-01T00:00:00Z" });
            }
            return { data: { user }, error: null };
          },
        },
      },
      from(table: string) {
        const filters: Row = {};
        let inFilter: [string, unknown[]] | undefined;
        let operation = "read";
        let payload: Row = {};
        let resolved = false;
        let selected: Row[] = [];
        const result = (single = false) => {
          if (
            table === state.failTable ||
            `${table}.${operation}` === state.failPoint
          )
            return {
              data: null,
              error: {
                message:
                  "private-db@example.test Bearer private-provider-token",
                details: "private-provider-details",
              },
            };
          if (!resolved) {
            resolved = true;
            const records = (state.tables[table] ??= []);
            selected = records.filter(
              (record) =>
                Object.entries(filters).every(
                  ([key, value]) => record[key] === value,
                ) &&
                (!inFilter || inFilter[1].includes(record[inFilter[0]])),
            );
            if (operation !== "read") {
              state.writes.push({
                table,
                operation,
                row: { ...payload },
                filters: { ...filters },
              });
              if (operation === "insert") {
                const row = {
                  id: `00000000-0000-4000-8000-${String(state.next++).padStart(12, "0")}`,
                  ...payload,
                };
                records.push(row);
                selected = [row];
              } else {
                for (const row of selected) Object.assign(row, payload);
              }
            }
          }
          return {
            data: single ? (selected[0] ?? null) : selected,
            error: null,
          };
        };
        const chain = {
          select: () => chain,
          order: () => chain,
          eq: (key: string, value: unknown) => {
            filters[key] = value;
            return chain;
          },
          in: (key: string, values: unknown[]) => {
            inFilter = [key, values];
            return chain;
          },
          insert: (row: Row) => {
            operation = "insert";
            payload = row;
            return chain;
          },
          update: (row: Row) => {
            operation = "update";
            payload = row;
            return chain;
          },
          single: async () => result(true),
          maybeSingle: async () => result(true),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve),
        };
        return chain;
      },
    };
  },
}));

import worker from "../worker/index.mjs";
import { handleNativeStaffInvitation } from "../worker/staffInvitations.mjs";

// Unit fake for the public RPC envelope, with commit-or-rollback state updates.
// PostgreSQL integration tests exercise the actual SQL authorization and locks.
function lifecycleRpc(payload: Row): { data: Row | null; error: Row | null } {
  const operation = String(payload.p_operation);
  const input = payload.p_input as Row;
  const draft = structuredClone(state.tables);
  const writes: typeof state.writes = [];
  const failure = (code: string) => ({
    data: { error: { code } },
    error: null,
  });
  const caller = draft.staff_users.find(
    (row) => row.user_id === payload.p_actor_user_id,
  );
  const founder = caller?.role === "superadmin" && caller.is_founder === true;
  if (!caller?.active || (!founder && caller.role !== "admin"))
    return failure("STAFF_MANAGER_REQUIRED");
  const assignment = draft.class_rep_assignments.find(
    (row) => row.id === input.assignmentId,
  );
  const staffId =
    operation === "revoke" ? assignment?.staff_user_id : input.staffUserId;
  let staff = draft.staff_users.find((row) =>
    staffId ? row.id === staffId : row.user_id === input.userId,
  );
  if (["set_role", "enroll_admin"].includes(operation) && !founder)
    return failure("FOUNDER_REQUIRED");
  if (operation === "reserve_invite" && input.role === "admin" && !founder)
    return failure("FOUNDER_REQUIRED");
  if (
    ["set_active", "record_resend", "reserve_invite"].includes(operation) &&
    staff?.role === "admin" &&
    !founder
  )
    return failure("FOUNDER_REQUIRED");
  if (staff?.is_founder) return failure("FOUNDER_PROTECTED");
  if (
    !["reserve_invite", "enroll_admin", "enroll_class_rep"].includes(
      operation,
    ) &&
    !staff
  )
    return failure("NOT_FOUND");
  if (
    ["assign", "revoke"].includes(operation) &&
    staff &&
    staff.role !== "class_rep"
  )
    return failure("NOT_FOUND");
  if (operation === "enroll_class_rep" && staff && staff.role !== "class_rep")
    return failure("ROLE_CHANGE_REQUIRED");
  if (
    (["assign", "enroll_class_rep"].includes(operation) ||
      (operation === "reserve_invite" && input.timetableId)) &&
    !draft.timetables.some((row) => row.id === input.timetableId)
  )
    return failure("TIMETABLE_NOT_FOUND");
  if (operation === "reserve_invite") {
    const email = String(input.email).trim().toLowerCase();
    if (state.reservedEmails.includes(email))
      return failure("INVITE_RATE_LIMITED");
    const actorKey = String(payload.p_actor_user_id);
    if ((state.actorAttempts[actorKey] ?? 0) >= 10)
      return failure("INVITE_ACTOR_RATE_LIMITED");
    state.reservedEmails.push(email);
    state.actorAttempts[actorKey] = (state.actorAttempts[actorKey] ?? 0) + 1;
    return { data: { reserved: true }, error: null };
  }
  const write = (
    table: string,
    action: string,
    row: Row,
    filters: Row = {},
  ) => {
    if (state.failTable === table || state.failPoint === `${table}.${action}`)
      throw new Error("synthetic transaction failure");
    writes.push({ table, operation: action, row, filters });
    const records = (draft[table] ??= []);
    if (action === "insert") {
      const inserted = {
        id: `00000000-0000-4000-8000-${String(state.next++).padStart(12, "0")}`,
        ...row,
      };
      records.push(inserted);
      return inserted;
    }
    const matched = records.filter((record) =>
      Object.entries(filters).every(([key, value]) => record[key] === value),
    );
    for (const record of matched) Object.assign(record, row);
    return matched[0];
  };
  const audit = () =>
    write("audit_logs", "insert", {
      actor_id: payload.p_actor_user_id,
      action: operation,
      entity_type: "staff_user",
      entity_id: staff?.id,
    });
  let result: Row = {};
  try {
    if (["enroll_admin", "enroll_class_rep"].includes(operation)) {
      const fields = {
        user_id: input.userId,
        email: input.email,
        display_name: input.displayName,
        role: operation === "enroll_admin" ? "admin" : "class_rep",
        active: true,
        is_founder: false,
        created_by: payload.p_actor_user_id,
      };
      staff = staff
        ? write("staff_users", "update", fields, { id: staff.id })
        : write("staff_users", "insert", fields);
      result = { staffUserId: staff.id, enrollment: input.enrollment };
    }
    if (["assign", "enroll_class_rep"].includes(operation)) {
      const existing = draft.class_rep_assignments.find(
        (row) =>
          row.staff_user_id === staff?.id &&
          row.timetable_id === input.timetableId &&
          row.active,
      );
      for (const row of draft.class_rep_assignments.filter(
        (row) =>
          row.staff_user_id === staff?.id &&
          row.active &&
          row.id !== existing?.id,
      ))
        write(
          "class_rep_assignments",
          "update",
          { active: false },
          { id: row.id },
        );
      const assigned =
        existing ??
        write("class_rep_assignments", "insert", {
          staff_user_id: staff!.id,
          timetable_id: input.timetableId,
          active: true,
          created_by: payload.p_actor_user_id,
        });
      if (!existing) audit();
      result =
        operation === "assign"
          ? { id: assigned.id }
          : { ...result, assignmentId: assigned.id };
    } else if (operation === "revoke") {
      if (assignment?.active) {
        write(
          "class_rep_assignments",
          "update",
          { active: false },
          { id: input.assignmentId },
        );
        audit();
      }
    } else if (operation === "set_active") {
      write(
        "staff_users",
        "update",
        { active: input.active },
        { id: staff!.id },
      );
      audit();
    } else if (operation === "set_role") {
      if (staff!.user_id === payload.p_actor_user_id)
        return failure("SELF_PRIVILEGE_CHANGE_FORBIDDEN");
      if (input.role === "admin")
        for (const row of draft.class_rep_assignments.filter(
          (row) => row.staff_user_id === staff!.id && row.active,
        ))
          write(
            "class_rep_assignments",
            "update",
            { active: false },
            { id: row.id },
          );
      write(
        "staff_users",
        "update",
        { role: input.role, active: input.role === "admin" },
        { id: staff!.id },
      );
      audit();
    } else if (operation === "record_resend") {
      if (staff!.user_id !== input.userId || staff!.email !== input.email)
        return failure("AUTH_IDENTITY_MISMATCH");
      if (input.invitationSent)
        write(
          "staff_users",
          "update",
          { last_invited_at: "2026-10-26T00:00:00Z" },
          { id: staff!.id },
        );
      audit();
      result = { enrollment: input.enrollment };
    } else if (
      operation !== "enroll_class_rep" &&
      operation !== "enroll_admin"
    ) {
      throw new Error(`Unexpected lifecycle operation: ${operation}`);
    }
    if (["enroll_admin", "enroll_class_rep"].includes(operation)) audit();
    state.tables = draft;
    state.writes.push(...writes);
    return { data: result, error: null };
  } catch {
    return { data: null, error: { message: "private-provider-details" } };
  }
}

const origin = "https://staging.example";
const env = {
  PUBLIC_APP_URL: "https://production.example",
  STAGING_ORIGIN: origin,
  SOURCE_SHA: "transport-fixture",
};
const ids = state.ids;
const invite = {
  email: "new-rep@example.test",
  displayName: "QA Class Rep",
  timetableId: ids.timetable,
};
const routes = [
  {
    label: "Class Rep invitation",
    path: "/api/admin/staff/invite",
    method: "POST",
    body: invite,
    status: 201,
  },
  {
    label: "invitation resend",
    path: `/api/admin/staff/${ids.rep}/resend-invite`,
    method: "POST",
    body: undefined,
    status: 200,
  },
  {
    label: "assignment",
    path: `/api/admin/staff/${ids.rep}/assignments`,
    method: "POST",
    body: { timetableId: ids.timetable },
    status: 201,
  },
  {
    label: "assignment revocation",
    path: `/api/admin/staff/assignments/${ids.assignment}`,
    method: "DELETE",
    body: undefined,
    status: 200,
  },
  {
    label: "active state",
    path: `/api/admin/staff/${ids.rep}`,
    method: "PATCH",
    body: { active: false },
    status: 200,
  },
] as const;
function actor(role = "admin", founder = false, active = true) {
  Object.assign(state.tables.staff_users[0], {
    role,
    is_founder: founder,
    active,
  });
}
function makeRequest(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + path, {
    method,
    headers: {
      authorization: "Bearer fixture-session",
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}
async function send(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await worker.fetch(
    makeRequest(path, method, body, headers),
    env,
    { waitUntil: () => {} },
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  return response;
}
const mutations = () =>
  state.writes.filter((entry) => entry.table !== "audit_logs");
beforeEach(() => {
  state.tables = {
    staff_users: [
      {
        id: ids.actorStaff,
        user_id: ids.actorUser,
        role: "admin",
        is_founder: false,
        active: true,
      },
      {
        id: ids.rep,
        user_id: ids.repUser,
        role: "class_rep",
        is_founder: false,
        active: true,
        email: "rep@example.test",
        display_name: "QA Rep",
      },
      {
        id: ids.admin,
        user_id: ids.adminUser,
        role: "admin",
        is_founder: false,
        active: true,
        email: "admin@example.test",
        display_name: "QA Admin",
      },
      {
        id: ids.founder,
        user_id: ids.founderUser,
        role: "superadmin",
        is_founder: true,
        active: true,
        email: "founder@example.test",
      },
    ],
    class_rep_assignments: [
      {
        id: ids.assignment,
        staff_user_id: ids.rep,
        timetable_id: ids.timetable,
        active: true,
      },
    ],
    audit_logs: [],
    timetables: [{ id: ids.timetable }, { id: ids.secondTimetable }],
  };
  state.users = [
    {
      id: ids.repUser,
      email: "rep@example.test",
      invited_at: "2026-10-01T00:00:00Z",
    },
    {
      id: ids.adminUser,
      email: "admin@example.test",
      invited_at: "2026-10-01T00:00:00Z",
    },
  ];
  state.writes = [];
  state.invitations = [];
  state.clients = [];
  state.userClients = [];
  state.failTable = "";
  state.failPoint = "";
  state.rpcCalls = [];
  state.reservedEmails = [];
  state.actorAttempts = {};
  state.next = 100;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(new Error("REMOTE_REQUEST_FORBIDDEN_IN_TRANSPORT_TEST")),
    ),
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Worker existing Class Rep and Team lifecycle transport", () => {
  it.each(routes)(
    "permits an operational Admin to use $label with the existing method/body contract",
    async (route) => {
      const response = await send(route.path, route.method, route.body);
      expect(response.status).toBe(route.status);
      const body = await response.json();
      if (route.label === "Class Rep invitation") {
        expect(body).toMatchObject({
          invite: { enrollment: "invited_new_user" },
        });
        expect(
          state.tables.staff_users.find(
            (row) => row.user_id === ids.invitedUser,
          ),
        ).toMatchObject({ role: "class_rep", is_founder: false, active: true });
        expect(
          state.tables.class_rep_assignments.some(
            (row) => row.timetable_id === ids.timetable && row.active === true,
          ),
        ).toBe(true);
        expect(state.invitations).toEqual([
          {
            email: invite.email,
            options: {
              data: { display_name: invite.displayName, product: "CalenderZW" },
              redirectTo: `${origin}/account/update-password`,
            },
            env,
          },
        ]);
      } else if (route.label === "invitation resend") {
        expect(body).toEqual({
          resend: { enrollment: "invite_resent_pending_user" },
        });
        expect(state.invitations).toHaveLength(1);
        expect(state.invitations[0].email).toBe("rep@example.test");
      } else if (route.label === "assignment") {
        expect(body).toMatchObject({ assignment: { id: expect.any(String) } });
        expect(
          state.tables.class_rep_assignments.filter((row) => row.active),
        ).toHaveLength(1);
      } else if (route.label === "assignment revocation") {
        expect(body).toEqual({ ok: true });
        expect(state.tables.class_rep_assignments[0].active).toBe(false);
      } else {
        expect(body).toEqual({ ok: true });
        expect(
          state.tables.staff_users.find((row) => row.id === ids.rep)?.active,
        ).toBe(false);
      }
      expect(state.clients.length).toBeGreaterThan(1);
      expect(state.clients.every((bindings) => bindings === env)).toBe(true);
      expect(state.userClients).toEqual([env]);
    },
  );

  it("strips caller privilege claims from a Class Rep invitation", async () => {
    const response = await send("/api/admin/staff/invite", "POST", {
      ...invite,
      role: "admin",
      isFounder: true,
      actor: { role: "superadmin" },
    });
    expect(response.status).toBe(201);
    expect(
      state.tables.staff_users.find((row) => row.user_id === ids.invitedUser),
    ).toMatchObject({
      role: "class_rep",
      is_founder: false,
      created_by: ids.actorUser,
    });
  });

  it("allows a founder to invite an Admin, but denies an ordinary Admin before enrollment", async () => {
    const payload = {
      email: "new-admin@example.test",
      displayName: "QA Admin",
    };
    const denied = await send("/api/admin/staff/invite-admin", "POST", payload);
    expect(denied.status).toBe(403);
    expect(mutations()).toEqual([]);
    expect(state.invitations).toEqual([]);
    actor("superadmin", true);
    const accepted = await send(
      "/api/admin/staff/invite-admin",
      "POST",
      payload,
    );
    expect(accepted.status).toBe(201);
    expect(
      state.tables.staff_users.find((row) => row.user_id === ids.invitedUser),
    ).toMatchObject({ role: "admin", is_founder: false });
  });

  it("restricts role changes to the founder while reusing the existing role transition", async () => {
    const path = `/api/admin/staff/${ids.rep}/role`;
    expect((await send(path, "PATCH", { role: "admin" })).status).toBe(403);
    expect(mutations()).toEqual([]);
    actor("superadmin", true);
    expect((await send(path, "PATCH", { role: "admin" })).status).toBe(200);
    expect(
      state.tables.staff_users.find((row) => row.id === ids.rep),
    ).toMatchObject({ role: "admin", active: true });
    expect(state.tables.class_rep_assignments[0].active).toBe(false);
  });

  it.each(["resend-invite", "active"])(
    "keeps target-Admin %s changes founder-only inside repository policy",
    async (action) => {
      const path = `/api/admin/staff/${ids.admin}${action === "resend-invite" ? "/resend-invite" : ""}`;
      const method = action === "resend-invite" ? "POST" : "PATCH";
      const body = action === "resend-invite" ? undefined : { active: false };
      const denied = await send(path, method, body);
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.code).toBe("FOUNDER_REQUIRED");
      expect(mutations()).toEqual([]);
      expect(state.invitations).toEqual([]);
      actor("superadmin", true);
      expect((await send(path, method, body)).status).toBe(200);
    },
  );

  it("never resends an invitation or changes active state for the protected founder", async () => {
    actor("superadmin", true);
    expect(
      (await send(`/api/admin/staff/${ids.founder}/resend-invite`, "POST"))
        .status,
    ).toBe(409);
    expect(
      (
        await send(`/api/admin/staff/${ids.founder}`, "PATCH", {
          active: false,
        })
      ).status,
    ).toBe(403);
    expect(mutations()).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it("does not assign a timetable to an Admin target", async () => {
    const response = await send(
      `/api/admin/staff/${ids.admin}/assignments`,
      "POST",
      { timetableId: ids.timetable },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
    expect(mutations()).toEqual([]);
  });

  it.each(routes)(
    "denies anonymous, invalid, inactive, unmarked-root and Class Rep callers on $label",
    async (route) => {
      for (const scenario of [
        "anonymous",
        "invalid",
        "inactive",
        "unmarked-root",
        "class_rep",
      ]) {
        actor(
          scenario === "class_rep"
            ? "class_rep"
            : scenario === "unmarked-root"
              ? "superadmin"
              : "admin",
          false,
          scenario !== "inactive",
        );
        const response = await send(
          route.path,
          route.method,
          route.body,
          scenario === "anonymous"
            ? { authorization: "" }
            : scenario === "invalid"
              ? { authorization: "Bearer invalid" }
              : {},
        );
        expect(response.status, scenario).toBe(
          ["anonymous", "invalid"].includes(scenario) ? 401 : 403,
        );
        expect(mutations(), scenario).toEqual([]);
        expect(state.invitations, scenario).toEqual([]);
      }
    },
  );

  it.each(routes)(
    "rejects wrong methods for $label with the expected Allow header",
    async (route) => {
      const response = await send(
        route.path,
        route.method === "POST" ? "PUT" : "POST",
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(route.method);
      expect(state.clients).toEqual([]);
      expect(state.writes).toEqual([]);
    },
  );

  it.each(routes)(
    "rejects cross-origin and cross-site $label before authorization or mutation",
    async (route) => {
      const forbiddenHeaders: Record<string, string>[] = [
        { origin: "https://attacker.example" },
        { origin: "null" },
        { "sec-fetch-site": "cross-site" },
      ];
      for (const headers of forbiddenHeaders) {
        const response = await send(
          route.path,
          route.method,
          route.body,
          headers,
        );
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("ORIGIN_NOT_ALLOWED");
        expect(state.clients).toEqual([]);
        expect(state.writes).toEqual([]);
      }
    },
  );

  it.each([
    [
      "/api/admin/staff/invite",
      "POST",
      { email: "invalid", displayName: "QA", timetableId: ids.timetable },
    ],
    [
      "/api/admin/staff/invite",
      "POST",
      { email: invite.email, displayName: "QA" },
    ],
    [
      `/api/admin/staff/${ids.rep}/assignments`,
      "POST",
      { timetableId: "not-a-uuid" },
    ],
    [`/api/admin/staff/${ids.rep}`, "PATCH", { active: "false" }],
    [`/api/admin/staff/${ids.rep}/role`, "PATCH", { role: "superadmin" }],
  ])(
    "preserves server-side schema validation for %s %s",
    async (path, method, body) => {
      actor("superadmin", true);
      const response = await send(String(path), String(method), body);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
      expect(state.writes).toEqual([]);
      expect(state.invitations).toEqual([]);
    },
  );

  it.each([
    ["wrong content type", "{}", { "content-type": "text/plain" }, 415],
    ["malformed JSON", "{", {}, 422],
    [
      "oversized JSON",
      JSON.stringify({ ...invite, displayName: "x".repeat(16385) }),
      {},
      413,
    ],
  ])(
    "rejects %s before invitation or database writes",
    async (_label, body, headers, status) => {
      const response = await send(
        "/api/admin/staff/invite",
        "POST",
        body,
        headers as Record<string, string>,
      );
      expect(response.status).toBe(status);
      expect(state.writes).toEqual([]);
      expect(state.invitations).toEqual([]);
    },
  );

  it("rejects invalid UTF-8 before repository mutation", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/admin/staff/invite`, {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-session",
          origin,
          "content-type": "application/json",
        },
        body: new Uint8Array([0xc3]),
      }),
      env,
      { waitUntil: () => {} },
    );
    expect(response.status).toBe(422);
    expect(state.writes).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it("returns repository errors without private provider details", async () => {
    state.failTable = "class_rep_assignments";
    const response = await send(
      `/api/admin/staff/${ids.rep}/assignments`,
      "POST",
      { timetableId: ids.secondTimetable },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("DATABASE_UNAVAILABLE");
    expect(body).not.toMatch(/private-db|private-provider|fixture-session/);
  });

  it.each(["assignment insert", "audit insert"])(
    "preserves the existing assignment if %s fails",
    async (failure) => {
      const before = structuredClone(state.tables.class_rep_assignments);
      if (failure === "assignment insert")
        state.failPoint = "class_rep_assignments.insert";
      else state.failTable = "audit_logs";
      const response = await send(
        `/api/admin/staff/${ids.rep}/assignments`,
        "POST",
        { timetableId: ids.secondTimetable },
      );
      expect(response.status).toBe(503);
      expect(state.tables.class_rep_assignments).toEqual(before);
      expect(state.invitations).toEqual([]);
    },
  );

  it("does not send a second pending invitation on an immediate resend retry", async () => {
    const path = `/api/admin/staff/${ids.rep}/resend-invite`;
    expect((await send(path, "POST")).status).toBe(200);
    const second = await send(path, "POST");
    expect([200, 409, 429]).toContain(second.status);
    expect(state.invitations).toHaveLength(1);
  });

  it.each([
    ...routes,
    { label: "staff collection", path: "/api/admin/staff", method: "GET" },
    {
      label: "Admin invitation",
      path: "/api/admin/staff/invite-admin",
      method: "POST",
    },
    {
      label: "role change",
      path: `/api/admin/staff/${ids.rep}/role`,
      method: "PATCH",
    },
  ])(
    "keeps all unsupported methods closed on $label",
    async ({ path, method }) => {
      for (const attempted of [
        "GET",
        "HEAD",
        "OPTIONS",
        "POST",
        "PATCH",
        "PUT",
        "DELETE",
      ].filter((entry) => entry !== method)) {
        const response = await handleNativeStaffInvitation(
          makeRequest(path, attempted),
          env,
        );
        expect(response?.status, attempted).toBe(405);
        expect(response?.headers.get("allow"), attempted).toBe(method);
        expect(state.clients).toEqual([]);
        expect(state.writes).toEqual([]);
      }
    },
  );

  it.each([
    ["/api/admin/staff/invite", "POST"],
    ["/api/admin/staff/invite-admin", "POST"],
    [`/api/admin/staff/${ids.rep}/assignments`, "POST"],
    [`/api/admin/staff/${ids.rep}`, "PATCH"],
    [`/api/admin/staff/${ids.rep}/role`, "PATCH"],
  ])(
    "requires JSON and rejects an empty JSON body on %s",
    async (path, method) => {
      actor("superadmin", true);
      expect((await send(path, method, undefined)).status).toBe(415);
      expect(
        (
          await send(path, method, undefined, {
            "content-type": "application/json",
          })
        ).status,
      ).toBe(422);
      expect(state.writes).toEqual([]);
      expect(state.invitations).toEqual([]);
    },
  );

  it("uses only the URL target for bodyless resend and assignment revocation", async () => {
    expect(
      (
        await send(`/api/admin/staff/${ids.rep}/resend-invite`, "POST", {
          staffUserId: ids.founder,
          email: "attacker@example.test",
          role: "superadmin",
        })
      ).status,
    ).toBe(200);
    expect(state.invitations.map((entry) => entry.email)).toEqual([
      "rep@example.test",
    ]);
    expect(
      (
        await send(`/api/admin/staff/assignments/${ids.assignment}`, "DELETE", {
          assignmentId: "attacker-assignment",
          staffUserId: ids.founder,
        })
      ).status,
    ).toBe(200);
    expect(state.tables.class_rep_assignments[0].active).toBe(false);
    expect(
      state.writes
        .filter((entry) => entry.table === "class_rep_assignments")
        .every((entry) => entry.filters.id === ids.assignment),
    ).toBe(true);
  });

  it("keeps confirmed-user resend as access confirmation without invitation or password recovery", async () => {
    Object.assign(state.users[0], {
      email_confirmed_at: "2026-10-02T00:00:00Z",
    });
    const response = await send(
      `/api/admin/staff/${ids.rep}/resend-invite`,
      "POST",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resend: { enrollment: "access_granted_existing_user" },
    });
    expect(state.invitations).toEqual([]);
    expect(mutations()).toEqual([]);
  });

  it.each([
    "/api/admin/staff/invite/extra",
    `/api/admin/staff/${ids.rep}/unknown`,
    `/api/admin/staff/${ids.rep}/assignments/extra`,
    `/api/admin/staff/assignments/${ids.assignment}/extra`,
    "/api/admin/staffish/invite",
  ])(
    "declines unknown routes without calling authorization: %s",
    async (path) => {
      expect(
        await handleNativeStaffInvitation(makeRequest(path, "POST", {}), env),
      ).toBeNull();
      expect(state.clients).toEqual([]);
      expect(state.writes).toEqual([]);
    },
  );
});
