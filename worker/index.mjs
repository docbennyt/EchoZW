/* global Headers, Response, URL, fetch, Request */

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

function applySecurityHeaders(headers) {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
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

async function serveSpaShell(request, env) {
  const url = new URL(request.url);
  const indexUrl = new URL("/index.html", url);
  const indexRequest = new Request(indexUrl, {
    method: request.method,
    headers: request.headers,
  });
  return withSecurityHeaders(await env.ASSETS.fetch(indexRequest));
}

export default {
  async fetch(request, env) {
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

    // Transitional staging bridge only. The final Cloudflare runtime replaces
    // this with native Worker adapters before production cutover. Browser HTML
    // is NEVER proxied to Railway.
    if (isDynamicPath(url.pathname)) {
      return proxyLegacyBackend(request, env);
    }

    // P0 guardrail: never let a missing hashed asset fall through to SPA HTML.
    // This prevents the historical text/html-as-JavaScript white-page failure.
    if (url.pathname.startsWith("/assets/")) {
      return notFound();
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
};
