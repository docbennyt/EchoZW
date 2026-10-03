import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readJsonc(path: string) {
  const source = readFileSync(path, "utf8");
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

const wrangler = readJsonc("wrangler.jsonc") as {
  main?: string;
  assets?: {
    directory?: string;
    binding?: string;
    not_found_handling?: string;
    run_worker_first?: string[];
  };
};
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
});
