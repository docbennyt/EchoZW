import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand: string;
  outputDirectory: string;
  rewrites: Array<{ source: string; destination: string }>;
  redirects: Array<{ source: string; destination: string; permanent: boolean }>;
};
const dockerfile = readFileSync("Dockerfile", "utf8");
const environmentTemplate = readFileSync(".env.example", "utf8");
const productionServer = readFileSync("server/productionServer.ts", "utf8");
const runtimePublicConfig = readFileSync("server/runtimePublicConfig.ts", "utf8");
const deploymentDocs = readFileSync(
  "docs/DEPLOYMENT_VERCEL_RAILWAY.md",
  "utf8",
);

describe("DR-119 Vercel + Railway deployment contract", () => {
  it("defines one canonical compiled Node production start command", () => {
    expect(packageJson.scripts.start).toBe(
      "node dist-server/server/productionServer.js",
    );
    expect(dockerfile).toContain('CMD ["npm", "start"]');
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).not.toContain("npm run dev");
  });

  it("routes backend traffic before the Vercel SPA fallback", () => {
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.outputDirectory).toBe("dist");

    const rewrites = new Map(
      vercel.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]),
    );
    expect(rewrites.get("/api/:path*")).toBe(
      "https://api.calender.aido.co.zw/api/:path*",
    );
    expect(rewrites.get("/runtime-config.js")).toBe(
      "https://api.calender.aido.co.zw/runtime-config.js",
    );
    expect(rewrites.get("/sitemap.xml")).toBe(
      "https://api.calender.aido.co.zw/sitemap.xml",
    );
    expect(rewrites.get("/t/:path*")).toBe(
      "https://api.calender.aido.co.zw/t/:path*",
    );
    expect(vercel.rewrites.at(-1)).toEqual({
      source: "/:path*",
      destination: "/index.html",
    });

    const apiIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/api/:path*",
    );
    const timetableSeoIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/t/:path*",
    );
    const fallbackIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/:path*",
    );
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(timetableSeoIndex).toBeGreaterThan(apiIndex);
    expect(fallbackIndex).toBeGreaterThan(timetableSeoIndex);
  });

  it("preserves legacy redirects and the public OAuth callback", () => {
    expect(vercel.redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/sync/:slug",
          destination: "/t/:slug",
          permanent: true,
        }),
        expect.objectContaining({
          source: "/dashboard",
          destination: "/admin",
          permanent: true,
        }),
      ]),
    );
    expect(environmentTemplate).toContain(
      "GOOGLE_REDIRECT_URI=https://calender.aido.co.zw/api/calendar/google/callback",
    );
  });

  it("keeps backend secrets out of Vercel routing and documents the deployment boundary", () => {
    const serializedVercel = JSON.stringify(vercel);
    expect(serializedVercel).not.toMatch(
      /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY|CALENDAR_TOKEN_HASH_SECRET/,
    );
    expect(environmentTemplate).toContain("# B. VERCEL FRONTEND");
    expect(environmentTemplate).toContain("# C. RAILWAY BACKEND");
    expect(deploymentDocs).toContain("Do not add a new legacy file");
    expect(deploymentDocs).toContain("SUPABASE_SECRET_KEY");
  });

  it("reports Railway release metadata and structured production startup failures", () => {
    expect(runtimePublicConfig).toContain("RAILWAY_GIT_COMMIT_SHA");
    expect(productionServer).toContain('event: "app.startup_config_error"');
    expect(productionServer).toContain("Secret values are not logged");
    expect(productionServer).toContain("process.env.PORT ?? 80");
    expect(productionServer).toContain('server.listen(port, "0.0.0.0"');
  });
});
