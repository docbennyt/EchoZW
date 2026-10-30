import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand: string;
  outputDirectory: string;
  rewrites: Array<{
    source: string;
    destination: string;
    has?: Array<{
      type: string;
      key: string;
      value?: string | { re?: string };
    }>;
  }>;
  redirects: Array<{ source: string; destination: string; permanent: boolean }>;
};
const dockerfile = readFileSync("Dockerfile", "utf8");
const environmentTemplate = readFileSync(".env.example", "utf8");
const productionServer = readFileSync("server/productionServer.ts", "utf8");
const runtimePublicConfig = readFileSync(
  "server/runtimePublicConfig.ts",
  "utf8",
);
const healthApi = readFileSync("server/healthApi.ts", "utf8");
const cloudflareSmoke = readFileSync(
  "scripts/smoke-native-recovery.mjs",
  "utf8",
);
const cloudflarePreviewWorkflow = readFileSync(
  ".github/workflows/cloudflare-pr-preview.yml",
  "utf8",
);
const cloudflareStagingWorkflow = readFileSync(
  ".github/workflows/cloudflare-staging.yml",
  "utf8",
);
const deploymentDocs = readFileSync(
  "docs/DEPLOYMENT_VERCEL_RAILWAY.md",
  "utf8",
);

const backendOrigin = "https://backend.calender.aido.co.zw";

describe("DR-119 Vercel + Railway deployment contract", () => {
  it("defines one canonical compiled Node production start command", () => {
    expect(packageJson.scripts.start).toBe(
      "node dist-server/server/productionServer.js",
    );
    expect(dockerfile).toContain('CMD ["npm", "start"]');
    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).not.toContain("npm run dev");
  });

  it("routes backend traffic to the verified production Worker before the Vercel SPA fallback", () => {
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.outputDirectory).toBe("dist");

    const rewrites = new Map(
      vercel.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]),
    );
    expect(rewrites.get("/api/:path*")).toBe(`${backendOrigin}/api/:path*`);
    expect(rewrites.get("/calendar/feed/:path*")).toBe(
      `${backendOrigin}/calendar/feed/:path*`,
    );
    expect(rewrites.get("/calendar/download/:path*")).toBe(
      `${backendOrigin}/calendar/download/:path*`,
    );
    expect(rewrites.get("/runtime-config.js")).toBe(
      `${backendOrigin}/runtime-config.js`,
    );
    expect(rewrites.get("/sitemap.xml")).toBe(`${backendOrigin}/sitemap.xml`);
    const classPageRewrite = vercel.rewrites.find(
      (rewrite) => rewrite.source === "/t/:slug",
    );
    const classGoogleRewrite = vercel.rewrites.find(
      (rewrite) => rewrite.source === "/t/:slug/google",
    );
    expect(classPageRewrite?.destination).toBe(`${backendOrigin}/t/:slug`);
    expect(classGoogleRewrite?.destination).toBe(
      `${backendOrigin}/t/:slug/google`,
    );
    for (const rewrite of [classPageRewrite, classGoogleRewrite]) {
      expect(rewrite?.has).toEqual([
        expect.objectContaining({
          type: "header",
          key: "user-agent",
          value: expect.objectContaining({
            re: expect.stringContaining("WhatsApp"),
          }),
        }),
      ]);
    }
    expect(rewrites.get("/t/:path*")).toBeUndefined();
    expect(rewrites.get("/find")).toBeUndefined();
    expect(vercel.rewrites.at(-1)).toEqual({
      source: "/:path((?!assets/).*)",
      destination: "/index.html",
    });

    const apiIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/api/:path*",
    );
    const calendarFeedIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/calendar/feed/:path*",
    );
    const calendarDownloadIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/calendar/download/:path*",
    );
    const sitemapIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/sitemap.xml",
    );
    const classSeoIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/t/:slug",
    );
    const fallbackIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/:path((?!assets/).*)",
    );
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(calendarFeedIndex).toBeGreaterThan(apiIndex);
    expect(calendarDownloadIndex).toBeGreaterThan(calendarFeedIndex);
    expect(sitemapIndex).toBeGreaterThan(apiIndex);
    expect(sitemapIndex).toBeGreaterThan(calendarDownloadIndex);
    expect(classSeoIndex).toBeGreaterThan(sitemapIndex);
    expect(fallbackIndex).toBeGreaterThan(classSeoIndex);
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
    expect(healthApi).toContain("/api/health/release");
    expect(healthApi).toContain("railway-node");
    expect(productionServer).toContain('event: "app.startup_config_error"');
    expect(productionServer).toContain("Secret values are not logged");
    expect(productionServer).toContain("process.env.PORT ?? 80");
    expect(productionServer).toContain('server.listen(port, "0.0.0.0"');
  });

  it("requires native proof separately from secretless Cloudflare PR checks", () => {
    expect(cloudflareSmoke).toContain("/api/health/release");
    expect(cloudflareSmoke).toContain("EXPECTED_RELEASE_SHA");
    expect(cloudflareSmoke).toContain("legacyBackendBridge === false");
    expect(cloudflareSmoke).toContain(
      "BLOCKED: CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN",
    );
    expect(cloudflarePreviewWorkflow).not.toContain("secrets.");
    expect(cloudflarePreviewWorkflow).not.toContain("environment:");
    expect(cloudflareStagingWorkflow).toContain(
      "authorize-staging-candidate.mjs",
    );
    expect(cloudflareStagingWorkflow).toContain("verify-staging-identity.mjs");
    expect(cloudflareStagingWorkflow).toContain("npm run worker:smoke:staging");
    expect(cloudflareStagingWorkflow).toContain(
      "npm run browser:smoke:release",
    );
    expect(cloudflarePreviewWorkflow).toContain(
      "name: Cloudflare PR Verification",
    );
    expect(cloudflarePreviewWorkflow).toContain("persist-credentials: false");
    expect(cloudflarePreviewWorkflow).not.toContain("secrets.");
    expect(cloudflarePreviewWorkflow).not.toContain(
      "environment: cloudflare-staging",
    );
    expect(cloudflarePreviewWorkflow).not.toContain("railway.app");
  });
});
