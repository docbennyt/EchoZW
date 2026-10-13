/* global Headers, Response, URL, fetch, Request, crypto, TextEncoder */

import {
  PilotApiError,
  setPilotRepositoryEnv,
} from "../server/pilotRepository.ts";
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
import { AdminAuthError, requireStaffUser } from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";
import { classifyAnalyticsClient } from "../src/domain/analytics.ts";
import { sha256Base64Url } from "../src/domain/token.ts";

const DYNAMIC_PREFIXES = ["/api/", "/calendar/"];
const DYNAMIC_EXACT_PATHS = new Set([
  "/runtime-config.js",
  "/sitemap.xml",
  "/healthz",
]);
const MAX_SOURCE_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTED_DOCX_MIME_TYPES = new Set([
  DOCX_MIME_TYPE,
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
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

async function proxyLegacyBackend(request, env) {
  if (!env.LEGACY_BACKEND_ORIGIN) {
    return json(
      {
        error: {
          code: "EDGE_BACKEND_NOT_CONFIGURED",
          message: "The staging backend bridge is not configured.",
        },
      },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    env.LEGACY_BACKEND_ORIGIN,
  );
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  headers.set("x-calenderzw-edge-runtime", "cloudflare-staging-bridge");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  applySecurityHeaders(responseHeaders);
  responseHeaders.set("x-calenderzw-edge-runtime", "cloudflare-staging-bridge");

  if (
    incoming.pathname.startsWith("/api/") ||
    incoming.pathname === "/runtime-config.js"
  ) {
    responseHeaders.set("cache-control", "no-store");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
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
    legacyBackendBridge: Boolean(env.LEGACY_BACKEND_ORIGIN),
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

function headerValue(headers, name) {
  return headers.get(name)?.trim() ?? "";
}

function requestHeaderValue(request, name) {
  return request.headers.get(name)?.trim() ?? "";
}

function decodeFilename(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function safeFilename(value) {
  return value.replace(/[^\w.\- ()]/g, "_").slice(0, 180);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function monthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
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
  if (request.method === "HEAD") {
    headers.set("content-length", "0");
    return new Response(null, { status: 200, headers });
  }
  headers.set("content-length", String(new TextEncoder().encode(ics).length));
  return new Response(ics, { status: 200, headers });
}

async function handleNativeCalendarIcs(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  if (!hasSupabaseServerConfig(env)) return null;
  setPilotRepositoryEnv(env);

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
      subscription = await getCalendarSubscriptionByTokenHash(tokenHash);
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

  if (!hasSupabaseServerConfig(env)) return null;

  setPilotRepositoryEnv(env);
  try {
    if (url.pathname === "/api/public/timetables") {
      return json(await listPublicTimetableDiscoveryResponse(), {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=300",
          "x-calenderzw-edge-runtime": "cloudflare-native-public-api",
        },
      });
    }

    const match = url.pathname.match(/^\/api\/public\/timetables\/([^/]+)$/);
    if (match) {
      return json(
        await getPublicTimetableResponse(decodeURIComponent(match[1])),
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

  if (!hasSupabaseServerConfig(env)) {
    return json(
      {
        error: {
          code: "AUTH_CONFIGURATION_ERROR",
          message: "CalenderZW staff authorization is not configured.",
        },
      },
      { status: 503 },
    );
  }

  try {
    const context = await requireStaffUser(
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

async function handleSourceDocumentUpload(request, env, ctx) {
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

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_SOURCE_DOCUMENT_BYTES
  ) {
    return json(
      {
        error: {
          code: "FILE_TOO_LARGE",
          message: "The DOCX file exceeds the 10 MB source upload limit.",
        },
      },
      { status: 413 },
    );
  }

  const filename = safeFilename(
    decodeFilename(headerValue(request.headers, "x-calenderzw-filename")),
  );
  if (!filename || !filename.toLocaleLowerCase("en").endsWith(".docx")) {
    return json(
      {
        error: {
          code: "DOCX_REQUIRED",
          message:
            "CalenderZW source upload currently accepts DOCX files only.",
        },
      },
      { status: 422 },
    );
  }

  const mimeType = headerValue(request.headers, "content-type")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ACCEPTED_DOCX_MIME_TYPES.has(mimeType)) {
    return json(
      {
        error: {
          code: "DOCX_MIME_REQUIRED",
          message: "CalenderZW source upload accepts DOCX documents only.",
        },
      },
      { status: 415 },
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return json(
      {
        error: {
          code: "EMPTY_FILE",
          message: "Choose a DOCX timetable document to upload.",
        },
      },
      { status: 422 },
    );
  }
  if (bytes.byteLength > MAX_SOURCE_DOCUMENT_BYTES) {
    return json(
      {
        error: {
          code: "FILE_TOO_LARGE",
          message: "The DOCX file exceeds the 10 MB source upload limit.",
        },
      },
      { status: 413 },
    );
  }

  const signature = new Uint8Array(bytes.slice(0, 4));
  if (
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 0x03 ||
    signature[3] !== 0x04
  ) {
    return json(
      {
        error: {
          code: "DOCX_ZIP_INVALID",
          message: "That file is not a valid DOCX ZIP container.",
        },
      },
      { status: 422 },
    );
  }

  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const r2Key = `source-documents/${monthKey()}/${sha256}/source.docx`;
  await env.SOURCE_BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: DOCX_MIME_TYPE },
    customMetadata: {
      sha256,
      originalFilename: filename,
      parser: "static-docx-matrix-v1",
      visibility: "private",
    },
  });

  const job = {
    kind: "source_document_uploaded",
    r2Key,
    sha256,
    originalFilename: filename,
    mimeType: DOCX_MIME_TYPE,
    sizeBytes: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  ctx.waitUntil(env.SOURCE_PROCESSING_QUEUE.send(job));

  return json(
    {
      document: {
        r2Key,
        sha256,
        originalFilename: filename,
        mimeType: DOCX_MIME_TYPE,
        sizeBytes: bytes.byteLength,
        queued: true,
      },
    },
    { status: 202 },
  );
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

export default {
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

    if (url.pathname === "/api/admin/session") {
      return handleNativeAdminSession(request, env);
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

    // Transitional staging bridge only. The final Cloudflare runtime replaces
    // this with native Worker adapters before production cutover. Browser HTML
    // is NEVER proxied to Railway.
    if (isDynamicPath(url.pathname)) {
      return proxyLegacyBackend(request, env);
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
      const body = message.body ?? {};
      if (body.kind === "source_document_uploaded" && body.r2Key) {
        message.ack();
        continue;
      }
      message.retry();
    }
  },
};
