import { describe, expect, it } from "vitest";
import {
  INDEXABLE_STATIC_ROUTES,
  getStaticSeoMetadata,
  isKnownSpaPath,
  noindexMetadataForPath,
} from "../src/domain/seo";
import { renderSitemap } from "../server/seoPublic";
import { injectSpaMetadata } from "../server/spaMetadata";

describe("public SEO policy", () => {
  it("keeps public discovery routes indexable and private routes noindex", () => {
    expect(INDEXABLE_STATIC_ROUTES).toContain("/find");
    expect(getStaticSeoMetadata("/find")?.robots).toBeUndefined();
    expect(getStaticSeoMetadata("/account/settings")?.robots).toBe(
      "noindex, nofollow",
    );
    expect(noindexMetadataForPath("/admin/analytics").robots).toBe(
      "noindex, nofollow",
    );
  });

  it("recognises only deliberate SPA route families", () => {
    expect(isKnownSpaPath("/t/hit-cs-1-1")).toBe(true);
    expect(isKnownSpaPath("/t/hit-cs-1-1/google")).toBe(true);
    expect(isKnownSpaPath("/admin/source-gateway")).toBe(true);
    expect(isKnownSpaPath("/definitely-not-a-page")).toBe(false);
  });

  it("renders canonical sitemap URLs and escapes XML", () => {
    const xml = renderSitemap([
      { path: "/find" },
      {
        path: "/t/programme&class",
        lastmod: "2026-09-04T08:00:00.000Z",
      },
    ]);
    expect(xml).toContain("https://calender.aido.co.zw/find");
    expect(xml).toContain("/t/programme&amp;class");
    expect(xml).toContain("2026-09-04T08:00:00.000Z");
  });

  it("injects canonical, robots, Open Graph, and X metadata server-side", () => {
    const html = `<!doctype html><html><head>
      <title>Old</title>
      <meta name="description" content="Old" />
      <link rel="canonical" href="https://calender.aido.co.zw/" />
      <meta property="og:title" content="Old" />
      <meta property="og:description" content="Old" />
      <meta property="og:url" content="https://calender.aido.co.zw/" />
      <meta property="og:image" content="https://calender.aido.co.zw/old.png" />
      <meta name="twitter:card" content="summary_large_image" />
    </head><body></body></html>`;

    const result = injectSpaMetadata(html, {
      title: "Find your university timetable | CalenderZW",
      description: "Find a published timetable.",
      canonicalPath: "/find",
      robots: "noindex, nofollow",
    });

    expect(result).toContain(
      "<title>Find your university timetable | CalenderZW</title>",
    );
    expect(result).toContain(
      '<link rel="canonical" href="https://calender.aido.co.zw/find" />',
    );
    expect(result).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(result).toContain(
      '<meta name="twitter:title" content="Find your university timetable | CalenderZW" />',
    );
  });
});
