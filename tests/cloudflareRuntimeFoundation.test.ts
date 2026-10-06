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
        consumers?: Array<{ queue?: string; dead_letter_queue?: string }>;
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
        "/runtime-config.js",
        "/sitemap.xml",
        "/__release",
      ]),
    );
    expect(routes).not.toContain("/assets/*");
    expect(routes).not.toContain("/*");
  });

  it("never serves SPA HTML for a missing hashed asset", () => {
    expect(worker).toContain('url.pathname.startsWith("/assets/")');
    expect(worker).toContain("return notFound();");
    expect(worker).toContain("NEVER proxied to Railway");
  });

  it("keeps Railway as a staging-only backend bridge rather than an HTML owner", () => {
    expect(worker).toContain("LEGACY_BACKEND_ORIGIN");
    expect(worker).toContain("Transitional staging bridge only");
    expect(worker).not.toContain("productionServer");
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
        },
        {
          queue: "calenderzw-push-staging",
          dead_letter_queue: "calenderzw-push-dlq-staging",
        },
      ]),
    );

    expect(staging?.vars?.PUBLIC_APP_URL).toBe("https://calender.aido.co.zw");
    expect(staging?.vars?.STAGING_ORIGIN).toBe(
      "https://next.calender.aido.co.zw",
    );
  });

  it("has a native private source upload path that writes R2 and queues processing", () => {
    expect(worker).toContain('url.pathname === "/api/edge/source-documents"');
    expect(worker).toContain("SOURCE_BUCKET.put");
    expect(worker).toContain("SOURCE_PROCESSING_QUEUE.send");
    expect(worker).toContain("source_document_uploaded");
    expect(worker).toContain("DOCX_ZIP_INVALID");
    expect(worker).toContain("MAX_SOURCE_DOCUMENT_BYTES");
    expect(worker).toContain("async queue(batch)");
  });
});
