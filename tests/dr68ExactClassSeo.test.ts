import { readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminTimetableSummary,
  PublicTimetable,
} from "../src/api/pilotTypes";
import { buildPublicTimetableMetadata } from "../src/domain/publicTimetable";
import { buildSitemapEntries, renderSitemap } from "../server/seoPublic";
import { renderSpaSeoResponse } from "../server/spaSeo";

const shell = `<!doctype html><html><head>
  <title>CalenderZW</title>
  <meta name="description" content="default" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://calender.aido.co.zw/" />
  <meta property="og:title" content="CalenderZW" />
  <meta property="og:description" content="default" />
  <meta property="og:url" content="https://calender.aido.co.zw/" />
  <meta property="og:image" content="https://calender.aido.co.zw/old.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="CalenderZW" />
  <meta name="twitter:description" content="default" />
  <meta name="twitter:image" content="https://calender.aido.co.zw/old.png" />
</head><body></body></html>`;

function makeTimetable(): PublicTimetable {
  return {
    timetableId: "tt-hit-ics-1-1",
    publicSlug: "hit-ics-1-1-august-semester-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Information Security and Assurance",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-09T08:00:00.000Z",
    versionNumber: 4,
    publicDisplay: {
      showVisualPreview: false,
      showChangeAlerts: false,
    },
    sessions: [],
  };
}

function summary(
  publicSlug: string,
  currentPublishedVersionId: string | null,
): AdminTimetableSummary {
  return {
    id: `tt-${publicSlug}`,
    publicSlug,
    institutionName: "Harare Institute of Technology",
    programmeName: "BTech Information Security and Assurance",
    classGroupLabel: "1.1",
    academicPeriodName: "August Semester 2026",
    status: currentPublishedVersionId ? "Published" : "Draft",
    lastUpdated: "2026-09-11T15:00:00.000Z",
    currentDraftVersionId: null,
    currentPublishedVersionId,
  };
}

describe("DR-68 exact-class SEO and public crawl contract", () => {
  it("builds unique exact-class metadata with period context and CalenderZW branding", () => {
    const metadata = buildPublicTimetableMetadata(makeTimetable());

    expect(metadata.title).toBe(
      "HIT · BTech Information Security and Assurance · Class 1.1 timetable | CalenderZW",
    );
    expect(metadata.description).toContain("August Semester 2026 timetable");
    expect(metadata.description).toContain(
      "BTech Information Security and Assurance, Class 1.1 at HIT",
    );
    expect(metadata.canonicalPath).toBe("/t/hit-ics-1-1-august-semester-2026");
  });

  it("serves crawlable home and finder metadata with query-free self canonicals", async () => {
    const home = await renderSpaSeoResponse(shell, "/?utm_source=campus");
    const finder = await renderSpaSeoResponse(
      shell,
      "/find?utm_medium=share&ref=class-rep",
    );

    expect(home.statusCode).toBe(200);
    expect(home.responseBody).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/" />',
    );
    expect(home.responseBody).not.toContain("utm_source");

    expect(finder.statusCode).toBe(200);
    expect(finder.responseBody).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/find" />',
    );
    expect(finder.responseBody).not.toContain("utm_medium");
  });

  it("renders exact timetable title/description/OG/X metadata server-side and strips share queries from the canonical", async () => {
    const resolver = vi.fn(async () => makeTimetable());
    const response = await renderSpaSeoResponse(
      shell,
      "/t/hit-ics-1-1-august-semester-2026?utm_source=whatsapp&callback=1",
      resolver,
    );

    expect(response.statusCode).toBe(200);
    expect(resolver).toHaveBeenCalledWith("hit-ics-1-1-august-semester-2026");
    expect(response.responseBody).toContain(
      "<title>HIT · BTech Information Security and Assurance · Class 1.1 timetable | CalenderZW</title>",
    );
    expect(response.responseBody).toContain(
      'property="og:title" content="HIT · BTech Information Security and Assurance · Class 1.1 timetable | CalenderZW"',
    );
    expect(response.responseBody).toContain(
      'name="twitter:title" content="HIT · BTech Information Security and Assurance · Class 1.1 timetable | CalenderZW"',
    );
    expect(response.responseBody).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/t/hit-ics-1-1-august-semester-2026" />',
    );
    expect(response.responseBody).toContain(
      'property="og:image" content="https://calender.aido.co.zw/calenderzw-share-1200x630.png"',
    );
    expect(response.responseBody).toContain(
      'property="og:image:width" content="1200"',
    );
    expect(response.responseBody).toContain(
      'property="og:image:height" content="630"',
    );
    expect(response.responseBody).not.toContain("utm_source");
    expect(response.responseBody).not.toContain("callback=1");
  });

  it("returns a true 404/noindex response for an unpublished or missing timetable", async () => {
    const missing = await renderSpaSeoResponse(
      shell,
      "/t/not-published?utm_source=search",
      async () => {
        throw new Error("not found");
      },
    );

    expect(missing.statusCode).toBe(404);
    expect(missing.cacheControl).toBe("no-store");
    expect(missing.responseBody).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(missing.responseBody).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/t/not-published" />',
    );
    expect(missing.responseBody).not.toContain("utm_source");
  });

  it("keeps Google connect noindex while canonicalizing to the public class page", async () => {
    const resolver = vi.fn(async () => makeTimetable());
    const response = await renderSpaSeoResponse(
      shell,
      "/t/hit-ics-1-1-august-semester-2026/google?code=secret&state=private",
      resolver,
    );

    expect(response.statusCode).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
    expect(response.responseBody).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(response.responseBody).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/t/hit-ics-1-1-august-semester-2026" />',
    );
    expect(response.responseBody).not.toContain("code=secret");
    expect(response.responseBody).not.toContain("state=private");
  });

  it("includes only deliberate static routes and currently published timetable routes in the sitemap", () => {
    const entries = buildSitemapEntries([
      summary("hit-ics-1-1-august-semester-2026", "published-v4"),
      summary("draft-class", null),
    ]);
    const paths = entries.map((entry) => entry.path);
    const xml = renderSitemap(entries);

    expect(paths).toContain("/");
    expect(paths).toContain("/find");
    expect(paths).toContain("/t/hit-ics-1-1-august-semester-2026");
    expect(paths).not.toContain("/t/draft-class");
    expect(xml).not.toContain("/admin");
    expect(xml).not.toContain("/auth/");
    expect(xml).not.toContain("/api/");
    expect(xml).not.toContain("/calendar/feed/");
    expect(xml).not.toContain("?token=");
  });

  it("keeps crawler rules and structured data truthful", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    const index = readFileSync("index.html", "utf8");

    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /calendar/feed/");
    expect(robots).toContain(
      "Sitemap: https://calender.aido.co.zw/sitemap.xml",
    );
    expect(index).not.toContain('"@type": "Event"');
  });

  it("ships one lightweight professional 1200x630 social image instead of the square app icon", () => {
    const path = "public/calenderzw-share-1200x630.png";
    const image = readFileSync(path);

    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    expect(statSync(path).size).toBeLessThan(100_000);

    const index = readFileSync("index.html", "utf8");
    expect(index).toContain("/calenderzw-share-1200x630.png");
    expect(index).not.toContain(
      'property="og:image" content="https://calender.aido.co.zw/web-app-manifest-512x512.png"',
    );
  });
});
