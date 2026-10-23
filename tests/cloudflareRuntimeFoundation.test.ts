import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJsonc(path: string) {
  const source = readFileSync(path, "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

type WranglerConfig = {
  main?: string;
  assets?: {
    directory?: string;
    binding?: string;
    not_found_handling?: string;
    run_worker_first?: string[];
  };
  env?: {
    staging?: {
      routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
      r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
      queues?: {
        producers?: Array<{ binding?: string; queue?: string }>;
        consumers?: Array<{
          queue?: string;
          dead_letter_queue?: string;
          max_retries?: number;
        }>;
      };
      vars?: Record<string, string>;
    };
  };
};

const wrangler = readJsonc("wrangler.jsonc") as WranglerConfig;
const worker = readFileSync("worker/index.mjs", "utf8");

describe("Cloudflare runtime foundation", () => {
  it("deploys the Vite SPA and Worker as one atomic Cloudflare unit", () => {
    expect(wrangler.main).toBe("./worker/index.mjs");
    expect(wrangler.assets?.directory).toBe("./dist/");
    expect(wrangler.assets?.binding).toBe("ASSETS");
    expect(wrangler.assets?.not_found_handling).toBe("single-page-application");
  });

  it("runs Worker compute only for explicitly dynamic or redirect routes", () => {
    const routes = wrangler.assets?.run_worker_first ?? [];
    expect(routes).toEqual(
      expect.arrayContaining([
        "/api/*",
        "/calendar/*",
        "/assets/*",
        "/runtime-config.js",
        "/sitemap.xml",
        "/__release",
      ]),
    );
    expect(routes).toContain("/assets/*");
    expect(routes).not.toContain("/*");
  });

  it("never serves SPA HTML for a missing hashed asset", () => {
    expect(worker).toContain('url.pathname.startsWith("/assets/")');
    expect(worker).toContain("return notFound();");
    expect(worker).toContain("NEVER proxied to Railway");
  });

  it("has no retired backend bridge and fails unported routes explicitly", () => {
    expect(worker).not.toContain("LEGACY_BACKEND_ORIGIN");
    expect(worker).toContain("EDGE_ROUTE_UNAVAILABLE");
    expect(JSON.stringify(wrangler)).not.toContain("railway.app");
    expect(worker).not.toContain("productionServer");
  });

  it("routes public timetable reads through native Worker transport when configured", () => {
    expect(worker).toContain("handleNativePublicTimetableApi");
    expect(worker).toContain("cloudflare-native-public-api");
    expect(worker.indexOf("handleNativePublicTimetableApi")).toBeLessThan(
      worker.indexOf("if (isDynamicPath(url.pathname))"),
    );
  });

  it("serves release, health, and runtime config without the legacy backend bridge", () => {
    expect(worker).toContain('url.pathname === "/runtime-config.js"');
    expect(worker).toContain('url.pathname === "/api/health/live"');
    expect(worker).toContain('url.pathname === "/api/health/release"');
    expect(worker).toContain('url.pathname === "/api/health/ready"');
    expect(worker).toContain("serveRuntimeConfig");
    expect(worker).toContain("backendReleasePayload");
    expect(worker).toContain("checkReadiness");
    expect(worker.indexOf('url.pathname === "/api/health/live"')).toBeLessThan(
      worker.indexOf("if (isDynamicPath(url.pathname))"),
    );
  });

  it("routes staff session reads through native Worker auth before the backend bridge", () => {
    expect(worker).toContain("handleNativeAdminSession");
    expect(worker).toContain('url.pathname === "/api/admin/session"');
    expect(worker).toContain("requireStaffUser");
    expect(worker).toContain("createSupabaseUserClient(accessToken, env)");
    expect(worker).toContain("createSupabaseAdminClient(env)");
    expect(worker.indexOf("handleNativeAdminSession")).toBeLessThan(
      worker.indexOf("if (isDynamicPath(url.pathname))"),
    );
  });

  it("serves calendar feed and download ICS through native Worker transport when configured", () => {
    expect(worker).toContain("handleNativeCalendarIcs");
    expect(worker).toContain('url.pathname.startsWith("/calendar/feed/")');
    expect(worker).toContain('url.pathname.startsWith("/calendar/download/")');
    expect(worker.indexOf("handleNativeCalendarIcs")).toBeLessThan(
      worker.indexOf("if (isDynamicPath(url.pathname))"),
    );
  });

  it("binds only isolated staging R2 and Queue resources", () => {
    const staging = wrangler.env?.staging;
    expect(staging?.routes).toContainEqual({
      pattern: "next.calender.aido.co.zw",
      custom_domain: true,
    });

    expect(staging?.r2_buckets).toEqual(
      expect.arrayContaining([
        {
          binding: "SOURCE_BUCKET",
          bucket_name: "calenderzw-source-staging",
        },
        {
          binding: "CALENDAR_ARTIFACT_BUCKET",
          bucket_name: "calenderzw-calendar-artifacts-staging",
        },
      ]),
    );

    expect(staging?.queues?.producers).toEqual(
      expect.arrayContaining([
        {
          binding: "SOURCE_PROCESSING_QUEUE",
          queue: "calenderzw-source-processing-staging",
        },
        {
          binding: "PUSH_QUEUE",
          queue: "calenderzw-push-staging",
        },
      ]),
    );
    expect(staging?.queues?.consumers).toEqual(
      expect.arrayContaining([
        {
          queue: "calenderzw-source-processing-staging",
          dead_letter_queue: "calenderzw-source-processing-dlq-staging",
          max_retries: 5,
        },
        {
          queue: "calenderzw-push-staging",
          dead_letter_queue: "calenderzw-push-dlq-staging",
          max_retries: 5,
          max_batch_size: 1,
          max_concurrency: 1,
        },
      ]),
    );

    expect(staging?.vars?.PUBLIC_APP_URL).toBe("https://calender.aido.co.zw");
    expect(staging?.vars?.STAGING_ORIGIN).toBe(
      "https://next.calender.aido.co.zw",
    );
  });

  it("fails incomplete intake closed and preserves queued work for retry/DLQ", () => {
    expect(worker).toContain('url.pathname === "/api/edge/source-documents"');
    expect(worker).toContain("assertSourceUploadAuth");
    expect(worker).toContain("EDGE_SOURCE_UPLOAD_SECRET");
    expect(worker).toContain("SOURCE_UPLOAD_AUTH_REQUIRED");
    expect(worker).toContain("SOURCE_PROCESSOR_UNAVAILABLE");
    expect(worker).not.toContain("message.ack()");
    expect(worker).toContain("message.retry(");
    expect(worker).toContain("source_document_uploaded");
    expect(worker).toContain("async queue(batch, env = {})");
    expect(worker).toContain("consumeGoogleDeliveryMessage(message, env)");
  });
});
