import type { IncomingMessage, ServerResponse } from "node:http";
import { INDEXABLE_STATIC_ROUTES } from "../src/domain/seo.js";
import { listTimetables } from "./pilotRepository.js";

const PUBLIC_ORIGIN = "https://calender.aido.co.zw";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeLastmod(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export type SitemapEntry = {
  path: string;
  lastmod?: string | null;
};

export function renderSitemap(entries: SitemapEntry[]) {
  const rows = entries
    .map((entry) => {
      const location = escapeXml(`${PUBLIC_ORIGIN}${entry.path}`);
      const lastmod = normalizeLastmod(entry.lastmod);
      return [
        "  <url>",
        `    <loc>${location}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    rows,
    "</urlset>",
    "",
  ].join("\n");
}

export async function buildPublicSitemap() {
  const timetableEntries = (await listTimetables())
    .filter((timetable) => Boolean(timetable.currentPublishedVersionId))
    .map((timetable) => ({
      path: `/t/${encodeURIComponent(timetable.publicSlug)}`,
      lastmod: timetable.lastUpdated,
    }));

  return renderSitemap([
    ...INDEXABLE_STATIC_ROUTES.map((path) => ({ path })),
    ...timetableEntries,
  ]);
}

export async function handleSeoPublicRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    requestUrl.pathname === "/sitemap.xml"
  ) {
    const body = await buildPublicSitemap();
    res.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  }

  return false;
}
