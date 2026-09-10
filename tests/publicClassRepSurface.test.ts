import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicSurfaceFiles = [
  "src/AppV2.tsx",
  "src/FinderDiscovery.tsx",
  "public/privacy/index.html",
  "public/terms/index.html",
  "public/data-deletion/index.html",
  "public/support/index.html",
] as const;

describe("public Class Rep surface", () => {
  it("does not advertise Admin login paths or Admin navigation language", () => {
    const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
    expect(finder).toContain('href="/rep/login"');
    expect(finder).toContain("Published by CalenderZW");

    for (const path of publicSurfaceFiles) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain('href="/admin"');
      expect(source).not.toContain('href="/admin/login"');
      expect(source).not.toContain(">Admin<");
      expect(source).not.toContain("Published from Admin");
      expect(source).not.toContain("Admin publication");
    }
  });
});
