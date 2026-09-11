import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AdminAuthError,
  requireFounderSuperadmin,
  requireOperationalAdmin,
  requireStaffManager,
  requireStaffUser,
  requireTimetableEditor,
  sendAdminAuthError,
  type AuthDependencies,
} from "./supabase/auth.js";
import { handleAcademicPauseAdminApi } from "./academicPauseAdminApi.js";
import { handleTimetablePublicSettingsAdminApi } from "./timetablePublicSettingsAdminApi.js";
import { handleCorrectionsAdminApi } from "./correctionsAdminApi.js";
import { handlePilotAdminApi } from "./pilotAdminApi.js";
import { handleStaffAdminApi } from "./staffAdminApi.js";
import { handleAdminAnalyticsApi } from "./adminAnalyticsApi.js";
import { handleGrowthInboxAdminApi } from "./growthInboxAdminApi.js";
import { handleSourceGatewayAdminApi } from "./sourceGatewayAdminApi.js";
import { sanitizeForLog } from "./observability.js";

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
  console.warn(
    JSON.stringify(
      sanitizeForLog({
        event: "auth.staff_session",
        scope,
        code:
          code === "FORBIDDEN" ||
          code === "SUPERADMIN_REQUIRED" ||
          code === "FOUNDER_REQUIRED" ||
          code === "OPERATIONAL_ADMIN_REQUIRED" ||
          code === "STAFF_MANAGER_REQUIRED"
            ? "AUTH_STAFF_SESSION_FORBIDDEN"
            : "AUTH_STAFF_SESSION_UNAVAILABLE",
      }),
    ),
  );
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

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/admin/my/timetables"
  ) {
    try {
      const context = await requireStaffUser(req, deps);
      sendJson(res, 200, { timetables: context.assignments });
    } catch (error) {
      logAdminFailure("admin-api", error);
      sendAdminAuthError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/staff")) {
    try {
      const context = await requireStaffManager(req, deps);
      if (await handleStaffAdminApi(req, res, context)) return true;
      sendJson(res, 501, {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "This staff operation is not implemented yet.",
        },
      });
    } catch (error) {
      logAdminFailure("admin-api", error);
      sendAdminAuthError(res, error);
    }
    return true;
  }

  const publicSettingsMatch = requestUrl.pathname.match(
    /^\/api\/admin\/timetables\/([^/]+)\/public-settings$/,
  );
  if (publicSettingsMatch) {
    try {
      const timetableId = decodeURIComponent(publicSettingsMatch[1]);
      const context = await requireFounderSuperadmin(req, deps);
      return await handleTimetablePublicSettingsAdminApi(
        req,
        res,
        context,
        timetableId,
      );
    } catch (error) {
      logAdminFailure("admin-api", error);
      sendAdminAuthError(res, error);
      return true;
    }
  }

  const scopedTimetableMatch = requestUrl.pathname.match(
    /^\/api\/admin\/timetables\/([^/]+)(?:\/corrections(?:\/[^/]+)?|\/exceptions(?:\/[^/]+)?|\/pauses(?:\/preview|\/[^/]+)?)$/,
  );
  if (scopedTimetableMatch) {
    try {
      const timetableId = decodeURIComponent(scopedTimetableMatch[1]);
      const context = await requireTimetableEditor(req, timetableId, deps);
      if (requestUrl.pathname.includes("/pauses")) {
        if (await handleAcademicPauseAdminApi(req, res, context, timetableId)) {
          return true;
        }
      } else if (await handleCorrectionsAdminApi(req, res, context)) {
        return true;
      }
      sendJson(res, 501, {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "This timetable operation is not implemented yet.",
        },
      });
    } catch (error) {
      logAdminFailure("admin-api", error);
      sendAdminAuthError(res, error);
    }
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/")) {
    try {
      const context = await requireOperationalAdmin(req, deps);
      if (requestUrl.pathname.startsWith("/api/admin/academic-pauses")) {
        if (await handleAcademicPauseAdminApi(req, res, context)) return true;
      }
      if (await handleAdminAnalyticsApi(req, res)) return true;
      if (await handleGrowthInboxAdminApi(req, res)) return true;
      if (await handleSourceGatewayAdminApi(req, res, context.user))
        return true;
      if (await handlePilotAdminApi(req, res, context.user)) return true;
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
