import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGoogleOAuthStartupStatus,
  validateGoogleOAuthProductionConfig,
} from "../src/domain/googleOAuthConfig.js";
import { validateLegalProductionConfig } from "../src/domain/legalValidation.js";
import { buildPublicTimetableMetadata } from "../src/domain/publicTimetable.js";
import {
  getStaticSeoMetadata,
  isKnownSpaPath,
  noindexMetadataForPath,
} from "../src/domain/seo.js";
import { handleAdminRequest } from "./adminApi.js";
import { handleAnalyticsRequest } from "./analyticsApi.js";
import { handleHealthRequest } from "./healthApi.js";
import {
  attachRequestLogging,
  classifyRoute,
  logUnknownRequestError,
  sanitizeForLog,
} from "./observability.js";
import { handlePilotCalendarRequest } from "./pilotCalendarApi.js";
import { handlePublicTimetableRequest } from "./publicTimetableApi.js";
import { getPublishedTimetableBySlug } from "./pilotRepository.js";
import {
  buildRuntimePublicConfig,
  runtimeConfigResponseHeaders,
  serializeRuntimeConfigScript,
} from "./runtimePublicConfig.js";
import { checkSchemaCompatibility } from "./schemaCompatibility.js";
import { handleSeoPublicRequest } from "./seoPublic.js";
import { injectSpaMetadata } from "./spaMetadata.js";
import { handleSourceSnapshotRequest } from "./sourceSnapshotApi.js";
import { startSourceProcessingWorker } from "./sourceProcessingWorker.js";
import { validateSupabaseProductionConfig } from "./supabase/config.js";
import { handleCalendarRequest } from "./viteCalendarPlugin.js";

const port = Number(process.env.PORT ?? 80);
const serverDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(serverDir, "../../dist");
const releaseSha =
  process.env.RENDER_GIT_COMMIT ??
  process.env.SOURCE_VERSION ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  null;

if (process.env.NODE_ENV === "production") {
  validateLegalProductionConfig(process.env);
  validateSupabaseProductionConfig(process.env);
  const googleStatus = validateGoogleOAuthProductionConfig(process.env);
  const googleStartup = getGoogleOAuthStartupStatus(process.env);
  const supabase = validateSupabaseProductionConfig(process.env);
  void checkSchemaCompatibility(process.env).then((schemaCompatibility) => {
    console.info(
      JSON.stringify(
        sanitizeForLog({
          event: "app.startup",
          app: "CalenderZW",
          environment: process.env.NODE_ENV,
          nodeVersion: process.version,
          port,
          publicOrigin: process.env.PUBLIC_APP_URL ?? null,
          releaseSha,
          supabase: {
            projectHost: supabase.projectHost,
            runtimeUrlConfigured: Boolean(process.env.SUPABASE_URL),
            publishableKeyConfigured: Boolean(supabase.publishableKey),
            privilegedKeyConfigured: Boolean(supabase.privilegedKey),
            browserRuntimeConfigAvailable: Boolean(
              supabase.url && supabase.publishableKey,
            ),
          },
          google: {
            enabled: googleStatus.enabled,
            redirectUri: googleStartup.redirectUri,
            clientIdSuffix: googleStartup.clientIdSuffix,
          },
          calendar: {
            tokenHashSecretConfigured: Boolean(
              process.env.CALENDAR_TOKEN_HASH_SECRET,
            ),
          },
          sourceIngestion: {
            enabled: Boolean(process.env.HIT_TIMETABLE_RELAY_SECRET),
            configured: Boolean(process.env.HIT_TIMETABLE_RELAY_SECRET),
          },
          analytics: {
            enabled: Boolean(process.env.ANALYTICS_ENABLED ?? true),
            configured: Boolean(process.env.SUPABASE_URL),
          },
          schemaCompatibility: {
            status: schemaCompatibility.status,
            requiredCount: schemaCompatibility.requiredCount,
            failureCount: schemaCompatibility.failures.length,
            failures: schemaCompatibility.failures,
          },
        }),
      ),
    );
  });
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function applySecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

function resolveStaticPath(req: IncomingMessage) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath =
    decodedPath === "/"
      ? "index.html"
      : normalize(decodedPath).replace(/^[/\\]+/, "");
  const filePath = resolve(join(distDir, relativePath));

  if (!filePath.startsWith(distDir)) {
    return undefined;
  }

  return filePath;
}

async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return false;

  const extension = extname(filePath);
  const cacheControl = filePath.includes(
    `${join("dist", "assets")}${process.platform === "win32" ? "\\" : "/"}`,
  )
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";

  res.writeHead(200, {
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": cacheControl,
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

async function serveSpaShell(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname = requestUrl.pathname;
  const html = await readFile(join(distDir, "index.html"), "utf8");
  let statusCode = isKnownSpaPath(pathname) ? 200 : 404;
  let metadata =
    getStaticSeoMetadata(pathname) ?? noindexMetadataForPath(pathname);

  const googleConnectMatch = pathname.match(/^\/t\/([^/]+)\/google\/?$/);
  const timetableMatch = pathname.match(/^\/t\/([^/]+)\/?$/);

  if (googleConnectMatch) {
    const slug = decodeURIComponent(googleConnectMatch[1]);
    metadata = {
      title: "Connect Google Calendar | CalenderZW",
      description: "Connect a published CalenderZW timetable to Google Calendar.",
      canonicalPath: `/t/${encodeURIComponent(slug)}`,
      robots: "noindex, nofollow",
    };
  } else if (timetableMatch) {
    const slug = decodeURIComponent(timetableMatch[1]);
    try {
      const timetable = await getPublishedTimetableBySlug(slug);
      metadata = buildPublicTimetableMetadata(timetable);
      statusCode = 200;
    } catch {
      metadata = noindexMetadataForPath(pathname);
      statusCode = 404;
    }
  }

  const responseBody = injectSpaMetadata(html, metadata);

  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(responseBody),
    "Cache-Control": statusCode === 404 ? "no-store" : "public, max-age=300",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(responseBody);
}

function serveRuntimeConfig(res: ServerResponse) {
  const script = serializeRuntimeConfigScript(
    buildRuntimePublicConfig(process.env),
  );
  res.writeHead(200, runtimeConfigResponseHeaders(Buffer.byteLength(script)));
  res.end(script);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed.");
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (
    requestUrl.pathname === "/dashboard" ||
    requestUrl.pathname.startsWith("/dashboard/")
  ) {
    res.writeHead(308, {
      Location: "/admin",
      "Cache-Control": "public, max-age=300",
    });
    res.end();
    return;
  }

  const legacySyncMatch = requestUrl.pathname.match(/^\/sync\/([^/]+)\/?$/);
  if (legacySyncMatch) {
    res.writeHead(308, {
      Location: `/t/${legacySyncMatch[1]}`,
      "Cache-Control": "public, max-age=300",
    });
    res.end();
    return;
  }

  const filePath = resolveStaticPath(req);
  if (filePath) {
    try {
      if (await serveFile(req, res, filePath)) return;
      if (await serveFile(req, res, join(filePath, "index.html"))) return;
    } catch {
      // Fall through to the SPA shell for client-side routes.
    }
  }

  await serveSpaShell(req, res);
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const route = classifyRoute(req.url);
  applySecurityHeaders(res);
  attachRequestLogging({ req, res, requestId, startedAt });
  try {
    if (
      req.method === "GET" &&
      new URL(req.url ?? "/", "http://localhost").pathname ===
        "/runtime-config.js"
    ) {
      serveRuntimeConfig(res);
      return;
    }
    if (await handleHealthRequest(req, res, process.env)) return;
    if (await handleSeoPublicRequest(req, res)) return;

    // Readiness is an infrastructure/deployment signal, not a global traffic
    // kill-switch. Individual handlers already surface dependency-specific
    // failures, while static/login/public shells must remain reachable so a
    // transient or false-negative readiness probe cannot take down the site.
    if (await handleAdminRequest(req, res)) return;
    if (await handleAnalyticsRequest(req, res, process.env)) return;
    if (await handlePublicTimetableRequest(req, res)) return;
    if (await handleSourceSnapshotRequest(req, res, process.env)) return;
    if (await handlePilotCalendarRequest(req, res, process.env, "production"))
      return;
    if (await handleCalendarRequest(req, res, "production")) return;
    await serveStatic(req, res);
  } catch (error) {
    logUnknownRequestError({
      error,
      requestId,
      route,
      durationMs: Date.now() - startedAt,
    });
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that request. Please try again.",
          requestId,
        },
      }),
    );
  }
});

const sourceProcessingWorker = startSourceProcessingWorker(process.env);

function shutdown() {
  sourceProcessingWorker.stop();
  server.close(() => process.exit(0));
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

server.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify(
      sanitizeForLog({
        event: "app.listening",
        app: "CalenderZW",
        port,
        releaseSha,
      }),
    ),
  );
});
