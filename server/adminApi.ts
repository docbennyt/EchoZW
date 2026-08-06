import type { IncomingMessage, ServerResponse } from "node:http";
import {
  requireAdmin,
  sendAdminAuthError,
  type AuthDependencies,
} from "./supabase/auth.js";

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

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthDependencies = {},
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && requestUrl.pathname === "/api/admin/session") {
    try {
      const user = await requireAdmin(req, deps);
      sendJson(res, 200, {
        authenticated: true,
        admin: true,
        user,
      });
    } catch (error) {
      sendAdminAuthError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/")) {
    try {
      await requireAdmin(req, deps);
      sendJson(res, 501, {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "This admin operation is not implemented yet.",
        },
      });
    } catch (error) {
      sendAdminAuthError(res, error);
    }
    return true;
  }

  return false;
}
