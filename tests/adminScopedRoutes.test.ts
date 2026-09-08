import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const handlerMocks = vi.hoisted(() => ({
  corrections: vi.fn(async (_req, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }),
  staff: vi.fn(async (_req, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }),
  analytics: vi.fn(async (_req, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }),
}));

vi.mock("../server/correctionsAdminApi", () => ({
  handleCorrectionsAdminApi: handlerMocks.corrections,
}));

vi.mock("../server/staffAdminApi", () => ({
  handleStaffAdminApi: handlerMocks.staff,
}));

vi.mock("../server/adminAnalyticsApi", () => ({
  handleAdminAnalyticsApi: handlerMocks.analytics,
}));

import { handleAdminRequest } from "../server/adminApi";

function request(
  method: string,
  url: string,
  authorization = "Bearer valid",
  body?: unknown,
) {
  const stream = Readable.from(
    body === undefined ? [] : [JSON.stringify(body)],
  ) as IncomingMessage;
  Object.assign(stream, {
    method,
    url,
    headers: authorization ? { authorization } : {},
  });
  return stream;
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    statusCode?: number;
  };
  res.writeHead = ((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return { res, body: () => JSON.parse(chunks.join("")) };
}

function userClient(user?: { id: string; email?: string }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: user ? { id: user.id, email: user.email } : null },
        error: null,
      })),
    },
  };
}

function adminClient(input: {
  staff?: {
    id: string;
    role: "superadmin" | "admin" | "class_rep";
    active: boolean;
    is_founder?: boolean;
  } | null;
  assignment?: { id: string; active: boolean } | null;
  legacyAdmin?: { user_id: string; active: boolean } | null;
}) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          const eqBuilder = {
            eq: vi.fn(() => eqBuilder),
            maybeSingle: vi.fn(async () => ({
              data:
                table === "staff_users"
                  ? (input.staff ?? null)
                  : table === "class_rep_assignments"
                    ? (input.assignment ?? null)
                    : (input.legacyAdmin ?? null),
              error: null,
            })),
          };
          return eqBuilder;
        }),
      })),
    })),
  };
}

describe("role-scoped admin route gates", () => {
  it("returns 401 for unauthenticated Class Rep correction attempts", async () => {
    const { res, body } = response();
    await handleAdminRequest(
      request("POST", "/api/admin/timetables/tt-a/corrections", ""),
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("AUTH_REQUIRED");
  });

  it("returns 403 for ordinary authenticated users", async () => {
    const { res, body } = response();
    await handleAdminRequest(
      request("POST", "/api/admin/timetables/tt-a/corrections"),
      res,
      {
        createUserClient: () => userClient({ id: "user-1" }),
        createAdminClient: () =>
          adminClient({ staff: null, legacyAdmin: null }),
      },
    );

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("FORBIDDEN");
  });

  it("allows a Class Rep assigned to timetable A to reach correction handling for A", async () => {
    const { res, body } = response();
    await handleAdminRequest(
      request("POST", "/api/admin/timetables/tt-a/corrections"),
      res,
      {
        createUserClient: () => userClient({ id: "rep-user" }),
        createAdminClient: () =>
          adminClient({
            staff: {
              id: "staff-rep",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
            assignment: { id: "assignment-a", active: true },
          }),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({ ok: true });
  });

  it("blocks a Class Rep from unassigned timetable correction APIs", async () => {
    const { res, body } = response();
    await handleAdminRequest(
      request("POST", "/api/admin/timetables/tt-b/corrections"),
      res,
      {
        createUserClient: () => userClient({ id: "rep-user" }),
        createAdminClient: () =>
          adminClient({
            staff: {
              id: "staff-rep",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
            assignment: null,
          }),
      },
    );

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("TIMETABLE_ACCESS_DENIED");
  });

  it("blocks a Class Rep from staff management", async () => {
    handlerMocks.staff.mockClear();
    const { res, body } = response();
    await handleAdminRequest(request("POST", "/api/admin/staff/invite"), res, {
      createUserClient: () => userClient({ id: "rep-user" }),
      createAdminClient: () =>
        adminClient({
          staff: {
            id: "staff-rep",
            role: "class_rep",
            active: true,
            is_founder: false,
          },
        }),
    });

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("STAFF_MANAGER_REQUIRED");
    expect(handlerMocks.staff).not.toHaveBeenCalled();
  });

  it("blocks a Class Rep from operational analytics APIs", async () => {
    handlerMocks.analytics.mockClear();
    const { res, body } = response();
    await handleAdminRequest(
      request("GET", "/api/admin/analytics/overview"),
      res,
      {
        createUserClient: () => userClient({ id: "rep-user" }),
        createAdminClient: () =>
          adminClient({
            staff: {
              id: "staff-rep",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
          }),
      },
    );

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("OPERATIONAL_ADMIN_REQUIRED");
    expect(handlerMocks.analytics).not.toHaveBeenCalled();
  });

  it("allows an operational Admin to reach global analytics", async () => {
    handlerMocks.analytics.mockClear();
    const { res, body } = response();
    await handleAdminRequest(
      request("GET", "/api/admin/analytics/overview"),
      res,
      {
        createUserClient: () => userClient({ id: "admin-user" }),
        createAdminClient: () =>
          adminClient({
            staff: {
              id: "staff-admin",
              role: "admin",
              active: true,
              is_founder: false,
            },
          }),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({ ok: true });
    expect(handlerMocks.analytics).toHaveBeenCalled();
  });

  it("allows an operational Admin to reach Class Rep team management", async () => {
    handlerMocks.staff.mockClear();
    const { res, body } = response();
    await handleAdminRequest(request("GET", "/api/admin/staff"), res, {
      createUserClient: () => userClient({ id: "admin-user" }),
      createAdminClient: () =>
        adminClient({
          staff: {
            id: "staff-admin",
            role: "admin",
            active: true,
            is_founder: false,
          },
        }),
    });

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({ ok: true });
    expect(handlerMocks.staff).toHaveBeenCalled();
  });

  it("allows the protected founder to reach operational APIs", async () => {
    handlerMocks.analytics.mockClear();
    const { res, body } = response();
    await handleAdminRequest(
      request("GET", "/api/admin/analytics/overview"),
      res,
      {
        createUserClient: () => userClient({ id: "founder-user" }),
        createAdminClient: () =>
          adminClient({
            staff: {
              id: "staff-founder",
              role: "superadmin",
              active: true,
              is_founder: true,
            },
          }),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({ ok: true });
  });
});
