// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "superadmin",
  founder: true,
  active: true,
  existing: null as Record<string, unknown> | null,
  users: [] as Record<string, unknown>[],
  writes: [] as { table: string; row: Record<string, unknown> }[],
  invitations: [] as {
    email: string;
    options: unknown;
    environment?: string;
  }[],
  enrollmentGate: null as null | (() => Promise<void>),
  failInvite: false,
  failAudit: false,
  staffRows: [] as Record<string, unknown>[],
  assignmentRows: [] as Record<string, unknown>[],
  listReads: [] as string[],
  enrollmentReads: 0,
  failList: false,
  throwList: false,
  rpcCalls: [] as { operation: string; input: Record<string, unknown> }[],
  reservedRecipients: [] as string[],
  actorAttempts: 0,
}));
vi.mock("../server/supabase/userClient.js", () => ({
  createSupabaseUserClient: () => ({
    auth: {
      getUser: async (token: string) => ({
        data: { user: token === "valid" ? { id: "founder-user" } : null },
        error: null,
      }),
    },
  }),
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: (bindings: NodeJS.ProcessEnv) => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("czw_staff_lifecycle");
      expect(args.p_actor_user_id).toBe("founder-user");
      const operation = String(args.p_operation);
      const input = args.p_input as Record<string, unknown>;
      state.rpcCalls.push({ operation, input });
      if (!state.active || state.role !== "superadmin" || !state.founder) {
        return { data: { error: { code: "FOUNDER_REQUIRED" } }, error: null };
      }
      if (operation === "reserve_invite") {
        expect(input.role).toBe("admin");
        const email = String(input.email).toLowerCase().trim();
        if (state.reservedRecipients.includes(email))
          return {
            data: { error: { code: "INVITE_RATE_LIMITED" } },
            error: null,
          };
        if (state.actorAttempts >= 10)
          return {
            data: { error: { code: "INVITE_ACTOR_RATE_LIMITED" } },
            error: null,
          };
        state.reservedRecipients.push(email);
        state.actorAttempts++;
        return { data: { reserved: true }, error: null };
      }
      if (operation !== "enroll_admin")
        throw new Error(
          `Unexpected native fixture RPC operation: ${operation}`,
        );
      expect(input.userId).toBe("invitee-user");
      const action =
        input.enrollment === "invited_new_user"
          ? "admin.invited"
          : input.enrollment === "invite_resent_pending_user"
            ? "admin.invite_resent"
            : "admin.access_granted_existing_user";
      const auditWrite = {
        table: "audit_logs",
        row: { actor_id: args.p_actor_user_id, action },
      };
      if (state.failAudit) {
        // Record the attempted audit without committing a membership mutation.
        state.writes.push(auditWrite);
        return {
          data: null,
          error: { message: "synthetic atomic audit failure" },
        };
      }
      state.writes.push(
        {
          table: "staff_users",
          row: {
            user_id: input.userId,
            role: "admin",
            is_founder: false,
            active: true,
            email: input.email,
            display_name: input.displayName,
            created_by: args.p_actor_user_id,
          },
        },
        auditWrite,
      );
      return {
        data: { staffUserId: "invitee-staff", enrollment: input.enrollment },
        error: null,
      };
    },
    auth: {
      admin: {
        listUsers: async () => {
          state.enrollmentReads += 1;
          if (state.enrollmentGate) await state.enrollmentGate();
          return { data: { users: state.users }, error: null };
        },
        inviteUserByEmail: async (email: string, options: unknown) => {
          state.invitations.push({
            email,
            options,
            ...(bindings?.INVITE_TEST_MARKER
              ? { environment: bindings.INVITE_TEST_MARKER }
              : {}),
          });
          return state.failInvite
            ? { data: { user: null }, error: {} }
            : { data: { user: { id: "invitee-user" } }, error: null };
        },
      },
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let mutation: Record<string, unknown> | undefined;
      const result = () => {
        const listing = !mutation && Object.keys(filters).length === 0;
        if (listing) {
          state.listReads.push(table);
          if (state.throwList) {
            throw new Error("private@example.test Bearer private-token");
          }
          return {
            data:
              table === "staff_users" ? state.staffRows : state.assignmentRows,
            error: state.failList
              ? { message: "private@example.test Bearer private-token" }
              : null,
          };
        }
        return {
          data: mutation
            ? { id: "invitee-staff", ...mutation }
            : table === "staff_users"
              ? filters.user_id === "founder-user"
                ? {
                    id: "founder-staff",
                    user_id: "founder-user",
                    role: state.role,
                    is_founder: state.founder,
                    active: state.active,
                  }
                : state.existing
              : [],
          error: table === "audit_logs" && state.failAudit ? {} : null,
        };
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        in: () => chain,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          mutation = row;
          state.writes.push({ table, row });
          return chain;
        },
        update: (row: Record<string, unknown>) => {
          mutation = row;
          state.writes.push({ table, row });
          return chain;
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  }),
}));
import worker from "../worker/index.mjs";
import { handleNativeStaffInvitation } from "../worker/staffInvitations.mjs";
const env = { PUBLIC_APP_URL: "https://app.example", SOURCE_SHA: "fixture" };
function request(
  payload: unknown = {
    email: "dedicated@example.test",
    displayName: "Dedicated Admin",
  },
  headers = {},
  method = "POST",
) {
  return worker.fetch(
    new Request("https://app.example/api/admin/staff/invite-admin", {
      method,
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        origin: "https://app.example",
        ...headers,
      },
      body:
        method === "GET"
          ? undefined
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload),
    }),
    env,
    { waitUntil: () => {} },
  );
}
beforeEach(() => {
  state.role = "superadmin";
  state.founder = true;
  state.active = true;
  state.existing = null;
  state.users = [];
  state.writes = [];
  state.invitations = [];
  state.failInvite = false;
  state.failAudit = false;
  state.enrollmentGate = null;
  state.staffRows = [];
  state.assignmentRows = [];
  state.listReads = [];
  state.enrollmentReads = 0;
  state.failList = false;
  state.throwList = false;
  state.rpcCalls = [];
  state.reservedRecipients = [];
  state.actorAttempts = 0;
  vi.stubEnv("PUBLIC_APP_URL", "https://app.example");
});
describe("native staff read", () => {
  function read(headers = {}, method = "GET") {
    return worker.fetch(
      new Request("https://app.example/api/admin/staff", {
        method,
        headers: { authorization: "Bearer valid", ...headers },
      }),
      env,
      { waitUntil: () => {} },
    );
  }

  function expectReadOnly() {
    expect(state.writes).toEqual([]);
    expect(state.invitations).toEqual([]);
    expect(state.enrollmentReads).toBe(0);
  }

  it.each(["founder", "admin"])(
    "returns staff and assignment summaries for %s without provisioning or audit writes",
    async (role) => {
      if (role === "admin") {
        state.role = "admin";
        state.founder = false;
      }
      state.staffRows = [
        {
          id: "rep-staff",
          user_id: "rep-user",
          email: "rep@example.test",
          display_name: "Class Rep",
          role: "class_rep",
          active: true,
          is_founder: false,
          invited_at: "2026-10-01",
          internal_only: "hidden",
        },
      ];
      state.assignmentRows = [
        {
          id: "assignment",
          staff_user_id: "rep-staff",
          timetable_id: "timetable",
          active: true,
          revoked_at: null,
          timetables: {
            public_slug: "class-a",
            institutions: { name: "Institution" },
            programmes: { name: "Programme" },
            cohorts: { label: "A" },
            academic_periods: { name: "2026" },
          },
        },
      ];
      const response = await read({ origin: "https://app.example" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        staff: [
          {
            id: "rep-staff",
            userId: "rep-user",
            email: "rep@example.test",
            displayName: "Class Rep",
            role: "class_rep",
            isFounder: false,
            active: true,
            invitedAt: "2026-10-01",
            lastInvitedAt: null,
            acceptedAt: null,
            disabledAt: null,
            assignments: [
              {
                id: "assignment",
                timetableId: "timetable",
                active: true,
                revokedAt: null,
                publicSlug: "class-a",
                institutionName: "Institution",
                programmeName: "Programme",
                classGroupLabel: "A",
                academicPeriodName: "2026",
              },
            ],
          },
        ],
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(state.listReads).toEqual(["staff_users", "class_rep_assignments"]);
      expectReadOnly();
    },
  );

  it("returns an empty staff collection without a JSON request body", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ staff: [] });
    expect(state.listReads).toEqual(["staff_users"]);
    expectReadOnly();
  });

  it.each([
    "class_rep",
    "nonfounder",
    "inactive",
    "anonymous",
    "invalid-token",
  ])("denies %s before reading the staff collection", async (role) => {
    if (role === "class_rep") state.role = role;
    if (role === "nonfounder") state.founder = false;
    if (role === "inactive") state.active = false;
    const response = await read(
      role === "anonymous"
        ? { authorization: "" }
        : role === "invalid-token"
          ? { authorization: "Bearer invalid" }
          : {},
    );
    expect(response.status).toBe(
      ["anonymous", "invalid-token"].includes(role) ? 401 : 403,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.listReads).toEqual([]);
    expectReadOnly();
  });

  it.each(["POST", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "rejects %s on the collection without opening more staff CRUD",
    async (method) => {
      const response = await read({}, method);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(state.listReads).toEqual([]);
      expectReadOnly();
    },
  );

  it.each([
    { origin: "https://other.example" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects cross-origin staff reads: %j", async (headers) => {
    const response = await read(headers);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(state.listReads).toEqual([]);
    expectReadOnly();
  });

  it.each([false, true])(
    "sanitizes read failures without PII logs (unexpected=%s)",
    async (unexpected) => {
      const logs = ["log", "info", "warn", "error", "debug"].map((method) =>
        vi.spyOn(console, method as "log").mockImplementation(() => {}),
      );
      try {
        state.failList = !unexpected;
        state.throwList = unexpected;
        const response = await read();
        expect(response.status).toBe(unexpected ? 500 : 503);
        expect(await response.json()).toEqual({
          error: {
            code: unexpected ? "INTERNAL_ERROR" : "DATABASE_UNAVAILABLE",
            message: unexpected
              ? "We could not complete that staff request."
              : "Could not load staff members.",
          },
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
        const logged = JSON.stringify(logs.flatMap((log) => log.mock.calls));
        expect(logged).not.toContain("private@example.test");
        expect(logged).not.toContain("private-token");
        expect(logged).not.toContain("Bearer valid");
        expectReadOnly();
      } finally {
        for (const log of logs) log.mockRestore();
      }
    },
  );

  it.each([
    "/api/admin/staff/member/unrecognized-action",
    "/api/admin/unrelated",
  ])("leaves other staff mutations outside the adapter: %s", async (path) => {
    expect(
      await handleNativeStaffInvitation(
        new Request(`https://app.example${path}`, {
          method: "POST",
          headers: { authorization: "Bearer valid" },
        }),
        env,
      ),
    ).toBeNull();
    expectReadOnly();
  });
});
describe("native founder Invite Admin", () => {
  function requestAt(
    origin: string,
    bindings: NodeJS.ProcessEnv,
    email = "dedicated@example.test",
  ) {
    return worker.fetch(
      new Request(`${origin}/api/admin/staff/invite-admin`, {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ email, displayName: "Dedicated Admin" }),
      }),
      bindings,
      { waitUntil: () => {} },
    );
  }

  it("returns invitation acceptance to the trusted staging request origin", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://production.example");
    const bindings = {
      PUBLIC_APP_URL: "https://production.example",
      STAGING_ORIGIN: "https://staging.example",
    };
    expect((await requestAt("https://staging.example", bindings)).status).toBe(
      201,
    );
    expect(state.invitations[0].options).toMatchObject({
      redirectTo: "https://staging.example/account/update-password",
    });
    expect(bindings.PUBLIC_APP_URL).toBe("https://production.example");
    expect(process.env.PUBLIC_APP_URL).toBe("https://production.example");
  });

  it("isolates overlapping invitation bindings and redirect origins", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://production.example");
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.enrollmentGate = async () => {
      if (++arrivals === 2) release();
      await bothArrived;
    };
    const results = await Promise.all(
      ["a", "b"].map((name) =>
        requestAt(
          `https://${name}.example`,
          {
            PUBLIC_APP_URL: "https://production.example",
            STAGING_ORIGIN: `https://${name}.example`,
            INVITE_TEST_MARKER: name,
          },
          `${name}@example.test`,
        ),
      ),
    );
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    for (const name of ["a", "b"]) {
      expect(state.invitations).toContainEqual({
        email: `${name}@example.test`,
        environment: name,
        options: expect.objectContaining({
          redirectTo: `https://${name}.example/account/update-password`,
        }),
      });
    }
    state.enrollmentGate = null;
    expect(
      (
        await requestAt("https://production.example", {
          PUBLIC_APP_URL: "https://production.example",
        })
      ).status,
    ).toBe(201);
    expect(state.invitations.at(-1)?.options).toMatchObject({
      redirectTo: "https://production.example/account/update-password",
    });
    expect(process.env.PUBLIC_APP_URL).toBe("https://production.example");
  });

  it.each([
    "https://other.example",
    "http://staging.example",
    "https://staging.example/untrusted",
    "invalid",
  ])(
    "does not trust unmatched or invalid staging origin %s",
    async (trusted) => {
      vi.stubEnv("PUBLIC_APP_URL", "https://production.example");
      expect(
        (
          await requestAt("https://staging.example", {
            PUBLIC_APP_URL: "https://production.example",
            STAGING_ORIGIN: trusted,
          })
        ).status,
      ).toBe(201);
      expect(state.invitations[0].options).toMatchObject({
        redirectTo: "https://production.example/account/update-password",
      });
    },
  );

  it("lets an invited non-founder Admin resolve staff access on the native session route", async () => {
    state.role = "admin";
    state.founder = false;
    const response = await worker.fetch(
      new Request("https://app.example/api/admin/session", {
        headers: { authorization: "Bearer valid" },
      }),
      env,
      { waitUntil: () => {} },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      staff: { role: "admin", isFounder: false },
      permissions: { canManageAdmins: false, canManageAllTimetables: true },
    });
    expect(state.writes).toEqual([]);
  });
  it("provisions a non-founder Admin through the existing invitation and audit flow", async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      invite: { staffUserId: "invitee-staff", enrollment: "invited_new_user" },
    });
    expect(state.invitations).toEqual([
      {
        email: "dedicated@example.test",
        options: {
          data: { display_name: "Dedicated Admin", product: "CalenderZW" },
          redirectTo: "https://app.example/account/update-password",
        },
      },
    ]);
    expect(state.writes).toContainEqual({
      table: "staff_users",
      row: expect.objectContaining({
        user_id: "invitee-user",
        role: "admin",
        is_founder: false,
        active: true,
        created_by: "founder-user",
      }),
    });
    expect(state.writes).toContainEqual({
      table: "audit_logs",
      row: expect.objectContaining({
        actor_id: "founder-user",
        action: "admin.invited",
      }),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["admin", "class_rep", "nonfounder", "inactive", "anonymous"])(
    "rejects %s before provisioning",
    async (role) => {
      if (role === "admin" || role === "class_rep") state.role = role;
      if (role === "nonfounder") state.founder = false;
      if (role === "inactive") state.active = false;
      const response = await request(
        undefined,
        role === "anonymous" ? { authorization: "" } : {},
      );
      expect(response.status).toBe(role === "anonymous" ? 401 : 403);
      expect(state.invitations).toEqual([]);
      expect(
        state.writes.filter((entry) => entry.table === "staff_users"),
      ).toEqual([]);
    },
  );
  it.each([
    ["cross-origin", {}, { origin: "https://other.example" }, "POST", 403],
    ["cross-site", {}, { "sec-fetch-site": "cross-site" }, "POST", 403],
    ["method", {}, {}, "GET", 405],
    ["media", {}, { "content-type": "text/plain" }, "POST", 415],
    ["JSON", "{", {}, "POST", 422],
    ["fields", { email: "invalid", displayName: "" }, {}, "POST", 422],
    ["oversized", "x".repeat(16385), {}, "POST", 413],
  ] as const)(
    "rejects invalid %s requests without provisioning",
    async (_name, body, headers, method, status) => {
      expect((await request(body, headers, method)).status).toBe(status);
      expect(state.invitations).toEqual([]);
      expect(state.writes).toEqual([]);
    },
  );
  it("grants existing confirmed users access without sending recovery or invitation email", async () => {
    state.users = [
      {
        id: "invitee-user",
        email: "dedicated@example.test",
        email_confirmed_at: "2026-10-01",
      },
    ];
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      invite: { enrollment: "access_granted_existing_user" },
    });
    expect(state.invitations).toEqual([]);
  });
  it("protects an existing founder membership", async () => {
    state.users = [
      {
        id: "invitee-user",
        email: "dedicated@example.test",
        email_confirmed_at: "2026-10-01",
      },
    ];
    state.existing = { id: "protected", role: "superadmin", is_founder: true };
    expect((await request()).status).toBe(409);
    expect(state.writes).toEqual([]);
  });
  it("resends a pending invitation using the same Auth identity", async () => {
    state.users = [
      {
        id: "invitee-user",
        email: "dedicated@example.test",
        invited_at: "2026-10-01",
      },
    ];
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      invite: { enrollment: "invite_resent_pending_user" },
    });
    expect(state.invitations).toHaveLength(1);
    expect(state.writes).toContainEqual({
      table: "audit_logs",
      row: expect.objectContaining({ action: "admin.invite_resent" }),
    });
  });
  it("rejects unconfirmed accounts that were never invited", async () => {
    state.users = [{ id: "invitee-user", email: "dedicated@example.test" }];
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "ACCOUNT_CONFIRMATION_REQUIRED" },
    });
    expect(state.invitations).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it("does not accept founder or actor authority from the request body", async () => {
    const response = await request({
      email: "dedicated@example.test",
      displayName: "Dedicated Admin",
      role: "superadmin",
      isFounder: true,
      actor: { userId: "attacker" },
    });
    expect(response.status).toBe(201);
    expect(state.writes).toContainEqual({
      table: "staff_users",
      row: expect.objectContaining({
        role: "admin",
        is_founder: false,
        created_by: "founder-user",
      }),
    });
  });
  it("does not create membership when Auth invitation fails", async () => {
    state.failInvite = true;
    expect((await request()).status).toBe(502);
    expect(state.writes).toEqual([]);
  });
  it("does not report success when the audit write fails", async () => {
    state.failAudit = true;
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Could not complete the staff lifecycle transaction.",
      },
    });
    expect(state.writes.some((entry) => entry.table === "audit_logs")).toBe(
      true,
    );
    expect(
      state.writes.filter((entry) => entry.table === "staff_users"),
    ).toEqual([]);
  });
});
