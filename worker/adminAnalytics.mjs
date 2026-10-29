/* global Response, URL */
import { ZodError } from "zod";
import { parseAnalyticsFilters } from "../src/domain/adminAnalytics.ts";
import {
  getAnalyticsOverview,
  getMetricDefinitions,
} from "../server/adminAnalyticsRepository.ts";
import {
  AdminAuthError,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleNativeAdminAnalytics(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/analytics/")) return null;
  if (
    !["/api/admin/analytics/metrics", "/api/admin/analytics/overview"].includes(
      url.pathname,
    )
  )
    return json(
      {
        error: { code: "NOT_FOUND", message: "Analytics endpoint not found." },
      },
      404,
    );
  if (request.method !== "GET")
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
    );
  try {
    await requireOperationalAdmin(
      {
        headers: {
          authorization: request.headers.get("authorization") ?? undefined,
        },
        method: request.method,
        url: url.pathname,
      },
      {
        createUserClient: (token) => createSupabaseUserClient(token, env),
        createAdminClient: () => createSupabaseAdminClient(env),
      },
    );
  } catch (error) {
    if (error instanceof AdminAuthError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return json(
      {
        error: {
          code: "AUTH_CONFIGURATION_ERROR",
          message: "Admin access is temporarily unavailable.",
        },
      },
      503,
    );
  }
  try {
    if (url.pathname === "/api/admin/analytics/metrics")
      return json({ metrics: getMetricDefinitions() });
    return json(
      await getAnalyticsOverview(parseAnalyticsFilters(url.searchParams), env),
    );
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Analytics filters are invalid.",
            details: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
        422,
      );
    return json(
      {
        error: {
          code: "ANALYTICS_UNAVAILABLE",
          message: "Analytics data is temporarily unavailable.",
        },
      },
      503,
    );
  }
}
