import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CalenderZW social sharing polish", () => {
  it("ships a non-empty absolute Open Graph image for WhatsApp/link previews", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toMatch(
      /property=["']og:image["'][^>]+https:\/\/calender\.aido\.co\.zw\//i,
    );
    expect(html).toMatch(
      /name=["']twitter:image["'][^>]+https:\/\/calender\.aido\.co\.zw\//i,
    );
  });

  it("keeps the WhatsApp CTA icon white on green", () => {
    const css = readFileSync("src/appV2.css", "utf8");
    expect(css).toContain("DR-173 WhatsApp CTA contrast");
    expect(css).toContain('a[href*="wa.me"] svg');
    expect(css).toContain("color: #fff !important");
  });

  it("uses intentional class-share copy instead of the old single-line message", () => {
    const candidates = ["src/domain/shareAttribution.ts"];
    const source = candidates
      .filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toContain(
      "timetable is live on CalenderZW — see tomorrow",
    );
    expect(source).toContain("timetable is now live on CalenderZW");
    expect(source).toContain(
      "add the full timetable to your calendar in one tap",
    );
  });
});
