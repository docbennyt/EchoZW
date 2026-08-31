import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  requireAdmin,
  requireAuthenticatedUser,
} from "../server/supabase/auth";
import { handleAdminRequest } from "../server/adminApi";

function request(authorization?: string) {
  return {
    headers: authorization ? { authorization } : {},
    method: "GET",
    url: "/api/admin/session",
  } as IncomingMessage;
}

function userClient(user?: { id: string; email?: string }, error?: Error) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: user ? { id: user.id, email: user.email } : null },
        error,
      })),
    },
  };
}

function adminClient(
  data: { user_id?: string; active?: boolean } | null,
  error?: Error,
) {
  const eqBuilder = {
    eq: vi.fn(() => eqBuilder),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => eqBuilder),
      })),
    })),
  };
}

function staffClient(data: {
  staff?: {
    id: string;
    user_id: string;
    role: "superadmin" | "class_rep";
    active: boolean;
  } | null;
  legacyAdmin?: { user_id?: string; active?: boolean } | null;
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
                  ? (data.staff ?? null)
                  : (data.legacyAdmin ?? null),
              error: null,
            })),
          };
          return eqBuilder;
        }),
      })),
    })),
  };
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    statusCode?: number;
    headers?: Record<string, string>;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return {
    res,
    body: () => JSON.parse(chunks.join("")),
  };
}

function routeRequest(path: string, authorization = "Bearer valid") {
  return {
    headers: { authorization },
    method: "GET",
    url: path,
  } as IncomingMessage;
}

describe("admin authentication helpers", () => {
  it("rejects missing Authorization with AUTH_REQUIRED", async () => {
    await expect(requireAuthenticatedUser(request())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
  });

  it("rejects malformed bearer tokens with AUTH_REQUIRED", async () => {
    await expect(
      requireAuthenticatedUser(request("Token nope")),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
  });

  it("rejects invalid Supabase tokens with AUTH_REQUIRED", async () => {
    await expect(
      requireAuthenticatedUser(request("Bearer bad"), {
        createUserClient: () => userClient(undefined, new Error("jwt expired")),
      }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
  });

  it("rejects authenticated non-admin users with FORBIDDEN", async () => {
    await expect(
      requireAdmin(request("Bearer valid"), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "user@example.test" }),
        createAdminClient: () => adminClient(null),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("rejects inactive admin rows with FORBIDDEN", async () => {
    await expect(
      requireAdmin(request("Bearer valid"), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "user@example.test" }),
        createAdminClient: () =>
          adminClient({ user_id: "user-1", active: false }),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("returns the authenticated user for active admins", async () => {
    await expect(
      requireAdmin(request("Bearer valid"), {
        createUserClient: () =>
          userClient({ id: "admin-1", email: "admin@example.test" }),
        createAdminClient: () =>
          adminClient({ user_id: "admin-1", active: true }),
      }),
    ).resolves.toEqual({
      id: "admin-1",
      email: "admin@example.test",
    });
  });

  it("maps database failures to a safe DATABASE_UNAVAILABLE error", async () => {
    await expect(
      requireAdmin(request("Bearer valid"), {
        createUserClient: () =>
          userClient({ id: "admin-1", email: "admin@example.test" }),
        createAdminClient: () =>
          adminClient(null, new Error("relation admin_users is missing")),
      }),
    ).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      status: 503,
    });
  });

  it("maps missing privileged config to AUTH_CONFIGURATION_ERROR", async () => {
    await expect(
      requireAdmin(request("Bearer valid"), {
        createUserClient: () =>
          userClient({ id: "admin-1", email: "admin@example.test" }),
        createAdminClient: () => {
          throw new Error("missing config");
        },
      }),
    ).rejects.toMatchObject({
      code: "AUTH_CONFIGURATION_ERROR",
      message: "CalenderZW staff authorization is temporarily unavailable.",
      status: 500,
    });
  });
});

describe("admin API routes", () => {
  it("returns 401 for anonymous admin session requests", async () => {
    const { res, body } = response();
    await handleAdminRequest(request(), res);
    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("AUTH_REQUIRED");
  });

  it("returns 403 for authenticated non-admin session requests", async () => {
    const { res, body } = response();
    await handleAdminRequest(request("Bearer valid"), res, {
      createUserClient: () =>
        userClient({ id: "user-1", email: "user@example.test" }),
      createAdminClient: () => adminClient(null),
    });

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("FORBIDDEN");
  });

  it("returns a minimal safe user object for active admins", async () => {
    const { res, body } = response();
    await handleAdminRequest(request("Bearer valid"), res, {
      createUserClient: () =>
        userClient({ id: "admin-1", email: "admin@example.test" }),
      createAdminClient: () =>
        adminClient({ user_id: "admin-1", active: true }),
    });

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({
      authenticated: true,
      admin: true,
      user: {
        id: "admin-1",
        email: "admin@example.test",
      },
      staff: {
        id: "admin-1",
        role: "superadmin",
        displayName: null,
        email: "admin@example.test",
      },
      permissions: {
        canManageStaff: true,
        canManageInstitutions: true,
        canManageProgrammes: true,
        canManageClassGroups: true,
        canManageAllTimetables: true,
        canEditAssignedTimetables: true,
        canPublishAssignedTimetables: true,
      },
      assignments: [],
    });
    expect(JSON.stringify(body())).not.toMatch(/token|password|service/i);
  });

  it("returns 403 when a class rep calls a global admin API route", async () => {
    const { res, body } = response();
    await handleAdminRequest(routeRequest("/api/admin/institutions"), res, {
      createUserClient: () =>
        userClient({ id: "rep-user", email: "rep@example.test" }),
      createAdminClient: () =>
        staffClient({
          staff: {
            id: "staff-rep",
            user_id: "rep-user",
            role: "class_rep",
            active: true,
          },
        }),
    });

    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("SUPERADMIN_REQUIRED");
  });

  it("returns a safe 500 response when privileged config is missing", async () => {
    const { res, body } = response();
    await handleAdminRequest(request("Bearer valid"), res, {
      createUserClient: () =>
        userClient({ id: "admin-1", email: "admin@example.test" }),
      createAdminClient: () => {
        throw new Error("missing config");
      },
    });

    expect(res.statusCode).toBe(500);
    expect(body()).toEqual({
      error: {
        code: "AUTH_CONFIGURATION_ERROR",
        message: "CalenderZW staff authorization is temporarily unavailable.",
      },
    });
  });
});
