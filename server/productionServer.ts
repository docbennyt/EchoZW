import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleCalendarRequest } from "./viteCalendarPlugin.js";

const port = Number(process.env.PORT ?? 80);
const serverDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(serverDir, "../../dist");

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

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed.");
    return;
  }

  const filePath = resolveStaticPath(req);
  if (filePath) {
    try {
      if (await serveFile(req, res, filePath)) return;
    } catch {
      // Fall through to the SPA shell for client-side routes.
    }
  }

  await serveFile(req, res, join(distDir, "index.html"));
}

const server = createServer(async (req, res) => {
  applySecurityHeaders(res);
  try {
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
  console.log(`EchoZW Calendar server listening on ${port}`);
});
