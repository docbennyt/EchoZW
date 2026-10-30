import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rewrite = {
  source: string;
  destination: string;
  has?: Array<{
    type: string;
    key: string;
    value?: string | { re?: string };
  }>;
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
  it("keeps browser SPA routes on Vercel while allowing crawler-only class SEO HTML", () => {
    const rewrites = loadVercelRewrites();

    for (const source of ["/find", "/assets/:path*", "/t/:path*"]) {
      const route = rewrites.find((rewrite) => rewrite.source === source);
      expect(route?.destination ?? "").not.toContain("railway.app");
    }

    const classPage = rewrites.find((rewrite) => rewrite.source === "/t/:slug");
    const googlePage = rewrites.find(
      (rewrite) => rewrite.source === "/t/:slug/google",
    );
    for (const route of [classPage, googlePage]) {
      expect(route?.destination).toBe(
        `https://backend.calender.aido.co.zw${route?.source}`,
      );
      expect(route?.has).toEqual([
        expect.objectContaining({
          type: "header",
          key: "user-agent",
          value: expect.objectContaining({
            re: expect.stringContaining("WhatsApp"),
          }),
        }),
      ]);
    }
  });

  it("routes backend-only resources to the verified production Worker and keeps the SPA shell on Vercel", () => {
    const rewrites = loadVercelRewrites();

    expect(rewrites).toContainEqual({
      source: "/api/:path*",
      destination: "https://backend.calender.aido.co.zw/api/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/calendar/feed/:path*",
      destination: "https://backend.calender.aido.co.zw/calendar/feed/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/calendar/download/:path*",
      destination:
        "https://backend.calender.aido.co.zw/calendar/download/:path*",
    });
    expect(rewrites).toContainEqual({
      source: "/runtime-config.js",
      destination: "https://backend.calender.aido.co.zw/runtime-config.js",
    });
    expect(rewrites).toContainEqual({
      source: "/sitemap.xml",
      destination: "https://backend.calender.aido.co.zw/sitemap.xml",
    });
    expect(rewrites.at(-1)).toEqual({
      source: "/:path((?!assets/).*)",
      destination: "/index.html",
    });
    expect(
      rewrites.filter((route) => route.destination.startsWith("https://")),
    ).toHaveLength(7);
    expect(JSON.stringify(rewrites)).not.toContain("railway.app");
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
