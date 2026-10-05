import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = {
  source: string;
  destination: string;
};

type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

function loadVercelRewrites(): Rewrite[] {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    rewrites?: Rewrite[];
  };

  return config.rewrites ?? [];
}

function loadVercelHeaderRules(): HeaderRule[] {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    headers?: HeaderRule[];
  };

  return config.headers ?? [];
}

describe("Vercel SPA asset-origin contract", () => {
  it("never serves /find or /t HTML from Railway while Vercel owns hashed assets", () => {
    const rewrites = loadVercelRewrites();

    for (const source of ["/find", "/t/:path*"]) {
      const route = rewrites.find((rewrite) => rewrite.source === source);
      expect(route?.destination ?? "").not.toContain("railway.app");
    }
  });

  it("keeps backend-only routes on Railway and the SPA shell on Vercel", () => {
    const rewrites = loadVercelRewrites();

    expect(rewrites).toContainEqual({
      source: "/api/:path*",
      destination: "https://calender.up.railway.app/api/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/calendar/feed/:path*",
      destination: "https://calender.up.railway.app/calendar/feed/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/calendar/download/:path*",
      destination: "https://calender.up.railway.app/calendar/download/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/runtime-config.js",
      destination: "https://calender.up.railway.app/runtime-config.js",
    });
    expect(rewrites).toContainEqual({
      source: "/sitemap.xml",
      destination: "https://calender.up.railway.app/sitemap.xml",
    });
    expect(rewrites.at(-1)).toEqual({
      source: "/:path*",
      destination: "/index.html",
    });
  });

  it("prevents Vercel rewrite caching for private calendar feed material", () => {
    const headers = loadVercelHeaderRules();

    for (const source of [
      "/api/:path*",
      "/calendar/feed/:path*",
      "/calendar/download/:path*",
      "/runtime-config.js",
    ]) {
      expect(headers).toContainEqual({
        source,
        headers: [
          {
            key: "x-vercel-enable-rewrite-caching",
            value: "0",
          },
        ],
      });
    }
  });
});
