import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { parseAnalyticsFilters } from "../src/domain/adminAnalytics.js";
import {
  getAnalyticsOverview,
  getMetricDefinitions,
} from "./adminAnalyticsRepository.js";

type AdminAnalyticsDependencies = {
  getOverview?: typeof getAnalyticsOverview;
  getMetrics?: typeof getMetricDefinitions;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  sendJson(res, status, { error: { code, message, details } });
}

function validationDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export async function handleAdminAnalyticsApi(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: AdminAnalyticsDependencies = {},
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/admin/analytics")) return false;

  if (req.method !== "GET") {
    sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    return true;
  }

  if (url.pathname === "/api/admin/analytics/metrics") {
    sendJson(res, 200, {
      metrics: (dependencies.getMetrics ?? getMetricDefinitions)(),
    });
    return true;
  }

  if (url.pathname === "/api/admin/analytics/overview") {
    try {
      const filters = parseAnalyticsFilters(url.searchParams);
      const overview = await (dependencies.getOverview ?? getAnalyticsOverview)(
        filters,
        env,
      );
      sendJson(res, 200, overview);
    } catch (error) {
      if (error instanceof ZodError) {
        sendError(
          res,
          422,
          "VALIDATION_ERROR",
          "Analytics filters are invalid.",
          validationDetails(error),
        );
        return true;
      }
      sendError(
        res,
        503,
        "ANALYTICS_UNAVAILABLE",
        "Analytics data is temporarily unavailable.",
      );
    }
    return true;
  }

  sendError(res, 404, "NOT_FOUND", "Analytics endpoint not found.");
  return true;
}
