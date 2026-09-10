import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public Class Rep surface", () => {
  it("does not advertise Admin login or Admin publication language in Finder", () => {
    const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");

    expect(finder).toContain('href="/rep/login"');
    expect(finder).toContain("Published by CalenderZW");
    expect(finder).not.toContain("/admin/login");
    expect(finder).not.toContain("Published from Admin");
    expect(finder).not.toContain("Admin publication");
  });
});
