import type { IncomingMessage, ServerResponse } from "node:http";

const SENSITIVE_PATTERN =
  /(authorization|password|secret|token|refresh|access|apikey|api[_-]?key|phone|email|code)/i;
const SAFE_DIAGNOSTIC_KEY_PATTERN =
  /(configured|available|enabled|status|count|duration|event|app|environment|version|port|origin|host|route|category|method|result|class)$/i;

export type RouteCategory =
  | "public_timetable"
  | "admin_session"
  | "calendar_subscription"
  | "calendar_feed"
  | "source_snapshot"
  | "analytics"
  | "staff_admin"
  | "correction_admin"
  | "health"
  | "runtime_config"
  | "google_oauth"
  | "static"
  | "unknown";

export type RouteInfo = {
  category: RouteCategory;
  template: string;
};

export function redactEmail(value: string | null | undefined) {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!name || !domain) return "redacted";
  return `${name.slice(0, 1)}***@${domain}`;
}

export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SENSITIVE_PATTERN.test(value) || value.includes("@")) return "redacted";
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_PATTERN.test(key) && !SAFE_DIAGNOSTIC_KEY_PATTERN.test(key)
          ? "redacted"
          : sanitizeForLog(entry),
      ]),
    );
  }
  return String(value);
}

export function classifyRoute(urlValue: string | undefined): RouteInfo {
  const pathname = new URL(urlValue ?? "/", "http://localhost").pathname;
  if (pathname === "/api/health/live" || pathname === "/api/health/ready") {
    return { category: "health", template: pathname };
  }
  if (pathname === "/runtime-config.js") {
    return { category: "runtime_config", template: "/runtime-config.js" };
  }
  if (pathname === "/api/admin/session") {
    return { category: "admin_session", template: "/api/admin/session" };
  }
  if (pathname.startsWith("/api/admin/timetables/")) {
    return {
      category: pathname.includes("/corrections")
        ? "correction_admin"
        : "staff_admin",
      template: "/api/admin/timetables/:id/:operation",
    };
  }
  if (pathname.startsWith("/api/admin/")) {
    return { category: "staff_admin", template: "/api/admin/:operation" };
  }
  if (pathname.startsWith("/api/public/timetables/")) {
    return {
      category: "public_timetable",
      template: "/api/public/timetables/:slug",
    };
  }
  if (pathname === "/api/public/timetables") {
    return { category: "public_timetable", template: pathname };
  }
  if (pathname === "/api/calendar/subscriptions") {
    return {
      category: "calendar_subscription",
      template: "/api/calendar/subscriptions",
    };
  }
  if (pathname.startsWith("/calendar/feed/")) {
    return { category: "calendar_feed", template: "/calendar/feed/:redacted" };
  }
  if (pathname.startsWith("/calendar/download/")) {
    return {
      category: "calendar_feed",
      template: "/calendar/download/:subscriptionId.ics",
    };
  }
  if (pathname === "/api/internal/source-snapshots") {
    return { category: "source_snapshot", template: pathname };
  }
  if (pathname === "/api/analytics/events") {
    return { category: "analytics", template: pathname };
  }
  if (pathname.startsWith("/api/google/")) {
    return { category: "google_oauth", template: "/api/google/:operation" };
  }
  if (pathname.startsWith("/api/")) {
    return { category: "unknown", template: "/api/:unknown" };
  }
  return {
    category: "static",
    template: pathname.startsWith("/t/") ? "/t/:slug" : pathname,
  };
}

export function errorCodeFor(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "INTERNAL_ERROR";
}

export function attachRequestLogging(input: {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  startedAt: number;
  logger?: Pick<Console, "info" | "error">;
}) {
  const logger = input.logger ?? console;
  const route = classifyRoute(input.req.url);
  input.res.setHeader("X-Request-Id", input.requestId);
  input.res.once("finish", () => {
    const status =
      typeof input.res.statusCode === "number" ? input.res.statusCode : 0;
    logger.info(
      JSON.stringify(
        sanitizeForLog({
          event: status >= 500 ? "request.failed" : "request.completed",
          requestId: input.requestId,
          method: input.req.method ?? "GET",
          route: route.template,
          category: route.category,
          status,
          durationMs: Date.now() - input.startedAt,
        }),
      ),
    );
  });
}

export function logUnknownRequestError(input: {
  error: unknown;
  requestId: string;
  route: RouteInfo;
  durationMs: number;
  logger?: Pick<Console, "error">;
}) {
  const logger = input.logger ?? console;
  logger.error(
    JSON.stringify(
      sanitizeForLog({
        event: "request.failed",
        requestId: input.requestId,
        route: input.route.template,
        category: input.route.category,
        errorCode: errorCodeFor(input.error),
        errorClass:
          input.error instanceof Error ? input.error.constructor.name : "Error",
        durationMs: input.durationMs,
      }),
    ),
  );
}
