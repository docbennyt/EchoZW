import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/config/brand";

const publicFiles = [
  "index.html",
  "public/site.webmanifest",
  "public/manifest.webmanifest",
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
      attribution: "Operated by aiDo",
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
    for (const manifestPath of [
      "public/site.webmanifest",
      "public/manifest.webmanifest",
    ]) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        short_name: string;
      };
      expect(manifest.name).toBe("CalenderZW");
      expect(manifest.short_name).toBe("CalenderZW");
    }
  });

  it("ships meaningful no-JavaScript homepage content in raw HTML", () => {
    const html = readFileSync("index.html", "utf8");
    const normalized = html.replace(/\s+/g, " ");

    expect(html).toContain(
      '<span class="brand-name">Calender<span>ZW</span></span>',
    );
    // expect(html).toContain('Student timetable and calendar synchronisation'); // Removed as copy changed
    expect(normalized).toContain(
      "Your university timetable, <span>already in your calendar.</span>",
    );
    expect(normalized).toContain(
      "CalenderZW helps students find a published class timetable",
    );
    expect(normalized).toContain("choose useful reminders");
    expect(html).toContain("Google Calendar");
    // The prerendered VPS page describes Google Calendar truthfully without the old access section
    expect(normalized).toContain(
      "CalenderZW helps students find a published class timetable",
    );
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/data-deletion"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('property="og:site_name" content="CalenderZW"');
    expect(html).toContain('name="application-name" content="CalenderZW"');
    expect(html).toContain(
      'name="apple-mobile-web-app-title" content="CalenderZW"',
    );
    expect(html).toContain('"name": "CalenderZW"');
    expect(html).toContain('"name": "aiDo"');
    expect(html).not.toContain("CalenderZW by aiDo");
    expect(html).not.toMatch(/<div id="root"><\/div>/);
  });

  it("keeps public production output free of ambiguous principal app names", () => {
    // index.html prerender now contains calender.aido.co.zw absolute URLs by design
    const nonHomepageFiles = publicFiles.filter((f) => f !== "index.html");
    for (const file of publicFiles) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("CalenderZW by aiDo");
      expect(text).not.toContain("aiDo CalenderZW");
      expect(text).not.toContain("CalendarZW");
    }
    for (const file of nonHomepageFiles) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(
        /calendar\.aido\.co\.zw|www\.calender\.aido\.co\.zw|localhost/i,
      );
    }
  });

  it("uses shared shell markers on static public verification pages", () => {
    for (const file of [
      "public/privacy/index.html",
      "public/terms/index.html",
      "public/data-deletion/index.html",
      "public/support/index.html",
    ]) {
      const html = readFileSync(file, "utf8");
      expect(html).toContain('data-component="GlobalHeader"');
      expect(html).toContain('data-component="GlobalFooter"');
      expect(html).toContain('aria-label="Product"');
      expect(html).toContain('aria-label="Support"');
      expect(html).toContain('aria-label="Legal"');
    }
  });
});
