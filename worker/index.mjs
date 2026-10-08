/* global Headers, Response, URL, fetch, Request, crypto */

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
    publicOrigin: env.PUBLIC_APP_URL ?? null,
    workerVersion: env.CF_VERSION_METADATA?.id ?? null,
    workerVersionTag: env.CF_VERSION_METADATA?.tag ?? null,
    workerVersionTimestamp: env.CF_VERSION_METADATA?.timestamp ?? null,
    legacyBackendBridge: Boolean(env.LEGACY_BACKEND_ORIGIN),
  };
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

async function handleSourceDocumentUpload(request, env, ctx) {
  if (request.method !== "POST") {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      { status: 405 },
    );
  }

  const bindingError = assertSourceUploadBindings(env);
  if (bindingError) return bindingError;

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
