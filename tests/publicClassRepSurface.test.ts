import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const standalonePublicFiles = [
  "public/privacy/index.html",
  "public/terms/index.html",
  "public/data-deletion/index.html",
  "public/support/index.html",
] as const;

describe("public Class Rep surface", () => {
  it("keeps advertised navigation and Finder Class Rep-facing", () => {
    const app = readFileSync("src/AppV2.tsx", "utf8");
    const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
    const navigationStart = app.indexOf("const publicNavigation = [");
    const navigationEnd = app.indexOf("] as const;", navigationStart);
    const publicNavigation = app.slice(navigationStart, navigationEnd);

    expect(publicNavigation).not.toContain('label: "Admin"');
    expect(app).toContain('href="/rep/login"');
    expect(app).toContain('<a href="/rep/login">Rep login</a>');

    expect(finder).toContain('href="/rep/login"');
    expect(finder).toContain("Published by CalenderZW");
    expect(finder).not.toContain('href="/admin/login"');
    expect(finder).not.toContain("Published from Admin");
    expect(finder).not.toContain("Admin publication");
  });

  it("keeps standalone public pages Admin-free", () => {
    for (const path of standalonePublicFiles) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain('href="/admin/login"');
      expect(source).not.toContain(">Admin<");
    }
  });
});
