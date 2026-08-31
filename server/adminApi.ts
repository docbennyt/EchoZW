import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AdminAuthError,
  requireStaffUser,
  requireSuperadmin,
  sendAdminAuthError,
  type AuthDependencies,
} from "./supabase/auth.js";
import { handlePilotAdminApi } from "./pilotAdminApi.js";

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function logAdminFailure(scope: "session" | "admin-api", error: unknown) {
  const code =
    error instanceof AdminAuthError ? error.code : "DATABASE_UNAVAILABLE";
  console.warn(`admin ${scope} failure: ${code}`);
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthDependencies = {},
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && requestUrl.pathname === "/api/admin/session") {
    try {
      const context = await requireStaffUser(req, deps);
      sendJson(res, 200, {
        authenticated: true,
        admin: true,
        user: context.user,
        staff: context.staff,
        permissions: context.permissions,
        assignments: context.assignments,
      });
    } catch (error) {
      logAdminFailure("session", error);
      sendAdminAuthError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/")) {
    try {
      const { user } = await requireSuperadmin(req, deps);
      if (await handlePilotAdminApi(req, res, user)) return true;
      sendJson(res, 501, {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "This admin operation is not implemented yet.",
        },
      });
    } catch (error) {
      logAdminFailure("admin-api", error);
      sendAdminAuthError(res, error);
    }
    return true;
  }

  return false;
}
