import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/config/brand";

const publicFiles = [
  "index.html",
  "public/site.webmanifest",
  "public/privacy/index.html",
  "public/terms/index.html",
  "public/data-deletion/index.html",
  "public/support/index.html",
];

describe("CalenderZW brand consistency", () => {
  it("uses the canonical brand configuration", () => {
    expect(BRAND).toMatchObject({
      productName: "CalenderZW",
      operatorName: "aiDo",
      attribution: "CalenderZW by aiDo",
      descriptor: "Student timetable and calendar synchronisation",
      domain: "calender.aido.co.zw",
      origin: "https://calender.aido.co.zw",
      supportEmail: "support@aido.co.zw",
      privacyEmail: "privacy@aido.co.zw",
    });
  });

  it("does not ship rejected legacy public names in static public output", () => {
    for (const file of publicFiles) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("CalenderZW");
      expect(text).not.toMatch(/EchoZW Calendar|Echo Calendar/i);
    }
  });

  it("sets manifest name and short name to CalenderZW", () => {
    const manifest = JSON.parse(
      readFileSync("public/site.webmanifest", "utf8"),
    ) as { name: string; short_name: string };
    expect(manifest.name).toBe("CalenderZW");
    expect(manifest.short_name).toBe("CalenderZW");
  });
});
