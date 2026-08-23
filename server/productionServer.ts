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
import { handleAdminRequest } from "./adminApi.js";
import { handlePilotCalendarRequest } from "./pilotCalendarApi.js";
import { handlePublicTimetableRequest } from "./publicTimetableApi.js";
import { getPublishedTimetableBySlug } from "./pilotRepository.js";
import { injectSpaMetadata } from "./spaMetadata.js";
import { handleSourceSnapshotRequest } from "./sourceSnapshotApi.js";
import { validateSupabaseProductionConfig } from "./supabase/config.js";
import { handleCalendarRequest } from "./viteCalendarPlugin.js";

const port = Number(process.env.PORT ?? 80);
const serverDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(serverDir, "../../dist");

if (process.env.NODE_ENV === "production") {
  validateLegalProductionConfig(process.env);
  validateSupabaseProductionConfig(process.env);
  const googleStatus = validateGoogleOAuthProductionConfig(process.env);
  if (googleStatus.enabled) {
    const { redirectUri, clientIdSuffix } = getGoogleOAuthStartupStatus(
      process.env,
    );
    console.info("Google OAuth configuration", {
      redirectUri,
      clientIdSuffix,
    });
  }
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function applySecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
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
  const publicShellPaths = new Set([
    "/",
    "/find",
    "/privacy",
    "/terms",
    "/data-deletion",
    "/support",
    "/account/settings",
  ]);
  const canonicalPath =
    requestUrl.pathname.startsWith("/t/") ||
    publicShellPaths.has(requestUrl.pathname)
      ? requestUrl.pathname
      : "/";
  const html = await readFile(join(distDir, "index.html"), "utf8");
  let responseBody = injectSpaMetadata(html, {
    title: "CalenderZW | Add your university timetable to your calendar",
    description:
      "Find a verified student timetable, choose useful reminders, and add lectures to Google Calendar, Apple Calendar, Outlook, or another calendar application.",
    canonicalPath,
    ogTitle: "CalenderZW",
    ogDescription: "Add your university timetable to your calendar.",
  });

  if (requestUrl.pathname.startsWith("/t/")) {
    const slug = decodeURIComponent(requestUrl.pathname.replace(/^\/t\//, ""));
    try {
      const timetable = await getPublishedTimetableBySlug(slug);
      responseBody = injectSpaMetadata(
        responseBody,
        buildPublicTimetableMetadata(timetable),
      );
    } catch {
      // Keep the generic public shell metadata when a timetable cannot be loaded.
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(responseBody),
    "Cache-Control": "public, max-age=300",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(responseBody);
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
  applySecurityHeaders(res);
  try {
    if (await handleAdminRequest(req, res)) return;
    if (await handlePublicTimetableRequest(req, res)) return;
    if (await handleSourceSnapshotRequest(req, res, process.env)) return;
    if (await handlePilotCalendarRequest(req, res, process.env, "production"))
      return;
    if (await handleCalendarRequest(req, res, "production")) return;
    await serveStatic(req, res);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that request. Please try again.",
        },
      }),
    );
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CalenderZW server listening on ${port}`);
});
