/* global Headers, Response, URL, Request, crypto, TextEncoder, TextDecoder, console */

import { PilotApiError, listInstitutions } from "../server/pilotRepository.ts";
import {
  getPublicTimetableResponse,
  listPublicTimetableDiscoveryResponse,
} from "../server/publicTimetableCore.ts";
import {
  buildRuntimePublicConfig,
  runtimeConfigResponseHeaders,
  serializeRuntimeConfigScript,
} from "../server/runtimePublicConfig.ts";
import { checkReadiness } from "../server/healthApi.ts";
import {
  getCalendarSubscriptionById,
  getCalendarSubscriptionByTokenHash,
} from "../server/pilotRepository.ts";
import { buildRevisionAwareCalendar } from "../server/pilotCalendarCore.ts";
import { recordCalendarFeedActivity } from "../server/analyticsRepository.ts";
import {
  AdminAuthError,
  requireStaffUser,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";
import {
  classifyAnalyticsClient,
  isAnalyticsUuid,
} from "../src/domain/analytics.ts";
import { sha256Base64Url } from "../src/domain/token.ts";
import { subscriptionRequestSchema } from "../src/domain/subscriptions.ts";
import { createNativeFeedSubscription } from "../server/calendarSubscriptionCore.ts";

const DYNAMIC_PREFIXES = ["/api/", "/calendar/"];
const DYNAMIC_EXACT_PATHS = new Set([
  "/runtime-config.js",
  "/sitemap.xml",
  "/healthz",
]);

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function publicApiError(error) {
  if (error instanceof PilotApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "We could not complete that request. Please try again.",
      },
    },
    { status: 500 },
  );
}

function adminAuthError(error) {
  if (error instanceof AdminAuthError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "We could not complete that request. Please try again.",
      },
    },
    { status: 500 },
  );
}

function applySecurityHeaders(headers) {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isDynamicPath(pathname) {
  return (
    DYNAMIC_EXACT_PATHS.has(pathname) ||
    DYNAMIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function redirectLocation(url) {
  if (url.pathname === "/dashboard") {
    return `/admin${url.search}`;
  }
  if (url.pathname.startsWith("/dashboard/")) {
    return `/admin/${url.pathname.slice("/dashboard/".length)}${url.search}`;
  }
  const syncMatch = url.pathname.match(/^\/sync\/([^/]+)\/?$/);
  if (syncMatch) {
    return `/t/${syncMatch[1]}${url.search}`;
  }
  return null;
}

function unavailable(code = "EDGE_ROUTE_UNAVAILABLE") {
  return json(
    {
      error: {
        code,
        message:
          "This service is temporarily unavailable during backend recovery.",
      },
    },
    { status: 503 },
  );
}

function releasePayload(env) {
  return {
    runtime: "cloudflare-workers",
    stage: env.APP_ENV ?? "unknown",
    sourceSha: env.SOURCE_SHA ?? null,
    publicOrigin: env.PUBLIC_APP_URL ?? null,
    workerVersion: env.CF_VERSION_METADATA?.id ?? null,
    workerVersionTag: env.CF_VERSION_METADATA?.tag ?? null,
    workerVersionTimestamp: env.CF_VERSION_METADATA?.timestamp ?? null,
    legacyBackendBridge: false,
  };
}

function backendReleasePayload(env) {
  return {
    runtime: "cloudflare-workers",
    environment: env.APP_ENV ?? null,
    sourceSha: env.SOURCE_SHA ?? null,
    service: "calenderzw-edge",
    workerVersion: env.CF_VERSION_METADATA?.id ?? null,
  };
}

function serveRuntimeConfig(env) {
  try {
    const script = serializeRuntimeConfigScript(buildRuntimePublicConfig(env));
    const headers = new Headers(runtimeConfigResponseHeaders(script.length));
    applySecurityHeaders(headers);
    return new Response(script, { status: 200, headers });
  } catch {
    return json(
      {
        error: {
          code: "RUNTIME_CONFIG_UNAVAILABLE",
          message: "Browser runtime configuration is unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

function notFound() {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  applySecurityHeaders(headers);
  return new Response("Not found.", { status: 404, headers });
}

function requestHeaderValue(request, name) {
  return request.headers.get(name)?.trim() ?? "";
}

function assertSourceUploadBindings(env) {
  if (!env.SOURCE_BUCKET || !env.SOURCE_PROCESSING_QUEUE) {
    return json(
      {
        error: {
          code: "SOURCE_UPLOAD_NOT_CONFIGURED",
          message: "Source upload storage is not configured for this runtime.",
        },
      },
      { status: 503 },
    );
  }
  return null;
}

function assertSourceUploadAuth(request, env) {
  const expected = env.EDGE_SOURCE_UPLOAD_SECRET?.trim();
  if (!expected) {
    return json(
      {
        error: {
          code: "SOURCE_UPLOAD_AUTH_NOT_CONFIGURED",
          message: "Source upload authentication is not configured.",
        },
      },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  const supplied =
    bearerMatch?.[1]?.trim() ??
    request.headers.get("x-calenderzw-edge-upload-secret")?.trim() ??
    "";

  if (!supplied || supplied !== expected) {
    return json(
      {
        error: {
          code: "SOURCE_UPLOAD_AUTH_REQUIRED",
          message: "Authenticated source upload access is required.",
        },
      },
      { status: 401 },
    );
  }

  return null;
}

function safeCalendarFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function requestHasEtag(request, etag) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

async function writeIcsResponse(request, calendarName, ics, lastModifiedValue) {
  const etag = `"${await sha256Base64Url(ics)}"`;
  const lastModified = new Date(lastModifiedValue);
  if (Number.isNaN(lastModified.getTime())) {
    throw new Error("Published timetable has an invalid revision timestamp.");
  }
  const headers = new Headers({
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `inline; filename="${safeCalendarFileName(calendarName)}.ics"`,
    "cache-control": "private, no-cache, max-age=0, must-revalidate",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
    vary: "Accept-Encoding",
    etag,
    "last-modified": lastModified.toUTCString(),
  });
  applySecurityHeaders(headers);

  if (requestHasEtag(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-length", String(new TextEncoder().encode(ics).length));
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(ics, { status: 200, headers });
}

async function handleNativeCalendarIcs(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  if (!hasSupabaseServerConfig(env))
    return unavailable("EDGE_SERVER_CONFIG_MISSING");

  const url = new URL(request.url);
  const publicOrigin = env.PUBLIC_APP_URL ?? url.origin;
  const downloadMatch = url.pathname.match(
    /^\/calendar\/download\/([^/]+)\.ics$/,
  );
  const feedMatch = url.pathname.match(/^\/calendar\/feed\/([^/]+)\.ics$/);

  try {
    let subscription;
    let statusCode = 200;
    if (downloadMatch) {
      subscription = await getCalendarSubscriptionById(
        decodeURIComponent(downloadMatch[1]),
        env,
      );
      if (!subscription || subscription.revoked_at) {
        throw new PilotApiError(
          "NOT_FOUND",
          "Calendar download not found.",
          404,
        );
      }
    } else if (feedMatch) {
      const token = decodeURIComponent(feedMatch[1]);
      const tokenHash = await sha256Base64Url(token);
      subscription = await getCalendarSubscriptionByTokenHash(tokenHash, env);
      if (!subscription || subscription.revoked_at) {
        throw new PilotApiError("NOT_FOUND", "Calendar feed not found.", 404);
      }
    } else {
      return null;
    }

    const timetableId = String(subscription.timetable_id);
    const reminders = subscription.reminder_offsets_minutes ?? [];
    const { ics, revision } = await buildRevisionAwareCalendar({
      timetableId,
      reminders,
      publicOrigin,
      env,
    });
    const response = await writeIcsResponse(
      request,
      String(subscription.calendar_name),
      ics,
      revision.updatedAt,
    );
    statusCode = response.status;

    if (feedMatch) {
      const subscriptionId = String(subscription.id);
      const client = classifyAnalyticsClient(
        requestHeaderValue(request, "user-agent"),
      );
      ctx.waitUntil(
        recordCalendarFeedActivity({ subscriptionId, statusCode, client }, env),
      );
    }

    return response;
  } catch (error) {
    return publicApiError(error);
  }
}

function hasSupabaseServerConfig(env) {
  return Boolean(
    (env.SUPABASE_URL || env.VITE_SUPABASE_URL) &&
    (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) &&
    (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY),
  );
}

async function handleNativePublicTimetableApi(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  if (!hasSupabaseServerConfig(env))
    return unavailable("EDGE_SERVER_CONFIG_MISSING");
  try {
    if (url.pathname === "/api/public/timetables") {
      return json(await listPublicTimetableDiscoveryResponse(env), {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=300",
          "x-calenderzw-edge-runtime": "cloudflare-native-public-api",
        },
      });
    }

    const match = url.pathname.match(/^\/api\/public\/timetables\/([^/]+)$/);
    if (match) {
      return json(
        await getPublicTimetableResponse(decodeURIComponent(match[1]), env),
        {
          headers: {
            "x-calenderzw-edge-runtime": "cloudflare-native-public-api",
          },
        },
      );
    }
  } catch (error) {
    return publicApiError(error);
  }

  return null;
}

async function handleNativeAdminSession(request, env) {
  if (request.method !== "GET") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  try {
    const url = new URL(request.url);
    const guard =
      url.pathname === "/api/admin/institutions"
        ? requireOperationalAdmin
        : requireStaffUser;
    const context = await guard(
      {
        headers: {
          authorization: request.headers.get("authorization") ?? undefined,
        },
        method: request.method,
        url: new URL(request.url).pathname,
      },
      {
        createUserClient: (accessToken) =>
          createSupabaseUserClient(accessToken, env),
        createAdminClient: () => createSupabaseAdminClient(env),
      },
    );

    if (url.pathname === "/api/admin/institutions") {
      return json({ institutions: await listInstitutions(env) });
    }
    if (url.pathname === "/api/admin/my/timetables") {
      return json({ timetables: context.assignments });
    }
    return json({
      authenticated: true,
      admin: true,
      user: context.user,
      staff: context.staff,
      permissions: context.permissions,
      assignments: context.assignments,
    });
  } catch (error) {
    return adminAuthError(error);
  }
}

async function handleNativeSubscription(request, env) {
  if (request.method !== "POST") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return json(
      {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Use the application origin.",
        },
      },
      { status: 403 },
    );
  }
  if (!hasSupabaseServerConfig(env))
    return unavailable("EDGE_SERVER_CONFIG_MISSING");
  try {
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return json(
            {
              error: {
                code: "BODY_TOO_LARGE",
                message: "Request body is too large.",
              },
            },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid JSON request." },
        },
        { status: 422 },
      );
    }
    const parsed = subscriptionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid calendar subscription request.",
          },
        },
        { status: 422 },
      );
    }
    const cookieId = request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("calenderzw_anon_session="))
      ?.slice("calenderzw_anon_session=".length);
    const suppliedId = request.headers.get("x-calenderzw-anonymous-id");
    const anonymousSessionId = isAnalyticsUuid(suppliedId)
      ? suppliedId
      : isAnalyticsUuid(cookieId)
        ? cookieId
        : crypto.randomUUID();
    const result = await createNativeFeedSubscription(parsed.data, {
      publicOrigin: url.origin,
      anonymousSessionId,
      env,
    });
    return json(result, {
      status: 201,
      headers: {
        "set-cookie": `calenderzw_anon_session=${anonymousSessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`,
      },
    });
  } catch (error) {
    return publicApiError(error);
  }
}

async function handleSourceDocumentUpload(request, env) {
  if (request.method !== "POST") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  const bindingError = assertSourceUploadBindings(env);
  if (bindingError) return bindingError;

  const authError = assertSourceUploadAuth(request, env);
  if (authError) return authError;

  // Intake stays closed until parse-to-review processing is implemented. Existing
  // queued objects are retried/DLQ'd below rather than acknowledged and lost.
  return unavailable("SOURCE_PROCESSOR_UNAVAILABLE");
}

async function serveSpaShell(request, env) {
  const url = new URL(request.url);
  const indexUrl = new URL("/index.html", url);
  const indexRequest = new Request(indexUrl, {
    method: request.method,
    headers: request.headers,
  });
  return withSecurityHeaders(await env.ASSETS.fetch(indexRequest));
}

async function serveAssetOr404(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  const contentType = assetResponse.headers.get("content-type") ?? "";

  // Cloudflare SPA fallback can turn a missing hashed asset into index.html.
  // Reject that fallback at the Worker boundary so stale HTML can never execute
  // with text/html-as-JavaScript after an atomic release.
  if (assetResponse.status !== 200 || /^text\/html(?:;|$)/i.test(contentType)) {
    return notFound();
  }

  return withSecurityHeaders(assetResponse);
}

const application = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/__release") {
      return json(releasePayload(env));
    }

    if (url.pathname === "/runtime-config.js") {
      return serveRuntimeConfig(env);
    }

    if (url.pathname === "/api/health/live") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/api/health/release") {
      return json(backendReleasePayload(env));
    }

    if (url.pathname === "/api/health/ready") {
      const readiness = await checkReadiness(env);
      return json(readiness, {
        status: readiness.status === "ready" ? 200 : 503,
      });
    }

    const redirectTo = redirectLocation(url);
    if (redirectTo) {
      const headers = new Headers({
        location: redirectTo,
        "cache-control": "public, max-age=300",
      });
      applySecurityHeaders(headers);
      return new Response(null, { status: 308, headers });
    }

    if (url.pathname === "/api/edge/source-documents") {
      return handleSourceDocumentUpload(request, env, ctx);
    }

    if (
      url.pathname === "/api/admin/session" ||
      url.pathname === "/api/admin/institutions" ||
      url.pathname === "/api/admin/my/timetables"
    ) {
      return handleNativeAdminSession(request, env);
    }

    if (url.pathname === "/api/calendar/subscriptions") {
      return handleNativeSubscription(request, env);
    }

    if (
      url.pathname === "/api/calendar/google/status" &&
      request.method === "GET"
    ) {
      return json({ enabled: false });
    }

    if (
      url.pathname.startsWith("/calendar/feed/") ||
      url.pathname.startsWith("/calendar/download/")
    ) {
      const nativeCalendar = await handleNativeCalendarIcs(request, env, ctx);
      if (nativeCalendar) return nativeCalendar;
    }

    if (
      url.pathname === "/api/public/timetables" ||
      url.pathname.startsWith("/api/public/timetables/")
    ) {
      const nativePublicApi = await handleNativePublicTimetableApi(
        request,
        env,
      );
      if (nativePublicApi) return nativePublicApi;
    }

    // Browser HTML is NEVER proxied to Railway. Unported APIs fail explicitly;
    // a dead backend is not a recovery fallback.
    if (isDynamicPath(url.pathname)) {
      return unavailable();
    }

    // P0 guardrail: /assets/* is Worker-first in Wrangler so the Worker can
    // distinguish a real immutable asset from Cloudflare's SPA HTML fallback.
    if (url.pathname.startsWith("/assets/")) {
      return serveAssetOr404(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return notFound();
    }

    const acceptsHtml = (request.headers.get("accept") ?? "").includes(
      "text/html",
    );
    const isNavigation = request.headers.get("sec-fetch-mode") === "navigate";
    if (acceptsHtml || isNavigation) {
      return serveSpaShell(request, env);
    }

    return notFound();
  },

  async queue(batch) {
    for (const message of batch.messages) {
      // No durable processor exists yet. Retry to the configured DLQ; never
      // acknowledge source_document_uploaded or push messages without work.
      message.retry({ delaySeconds: 300 });
    }
  },
};

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    let response;
    try {
      response = await application.fetch(request, env, ctx);
    } catch {
      response = publicApiError(new Error("REQUEST_FAILED"));
    }
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-calenderzw-source-sha", env.SOURCE_SHA ?? "unknown");
    // Private feed tokens live in URL paths. Never log a raw URL, query, headers
    // or provider payload; platform invocation logs/traces are disabled too.
    const path = new URL(request.url).pathname;
    const routeClass = path.startsWith("/calendar/")
      ? "calendar"
      : path.startsWith("/api/admin/")
        ? "admin"
        : path.startsWith("/api/")
          ? "api"
          : "asset";
    console.info(
      JSON.stringify({
        event: "edge.request",
        requestId,
        release: env.SOURCE_SHA ?? null,
        routeClass,
        status: response.status,
        durationMs: Date.now() - started,
      }),
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  queue: application.queue,
};
