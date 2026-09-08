import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-47 Class Rep distribution kit", () => {
  const source = readFileSync(
    "src/ClassRepCorrectionSafetyEnhancement.tsx",
    "utf8",
  );

  it("exposes one-tap class sharing plus explicit message/link fallbacks", () => {
    expect(source).toContain("Share with class");
    expect(source).toContain("Copy class message");
    expect(source).toContain("Copy public link");
    expect(source).toContain('source: "class_rep"');
  });

  it("blocks broad distribution while class-truth duplicate warnings remain", () => {
    expect(source).toContain("classDistributionBlocked");
    expect(source).toContain("duplicateGroups.length > 0");
    expect(source).toContain("Resolve the duplicate class-truth warning");
  });

  it("never builds distribution from a private feed URL", () => {
    expect(source).toContain("/t/${encodeURIComponent(assignment.publicSlug)}");
    expect(source).not.toContain("/calendar/feed/");
  });
});
