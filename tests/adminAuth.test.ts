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
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data, error })),
        })),
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
      createAdminClient: () => adminClient({ user_id: "admin-1", active: true }),
    });

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({
      authenticated: true,
      admin: true,
      user: {
        id: "admin-1",
        email: "admin@example.test",
      },
    });
    expect(JSON.stringify(body())).not.toMatch(/token|password|service/i);
  });
});
