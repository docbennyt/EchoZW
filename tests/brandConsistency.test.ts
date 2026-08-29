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

const staticVerificationPages = [
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

  it("ships a concise meaningful no-JavaScript homepage fallback", () => {
    const html = readFileSync("index.html", "utf8");
    const normalized = html.replace(/\s+/g, " ");

    expect(html).toContain("<noscript>");
    expect(normalized).toContain("Find a published university class timetable");
    expect(normalized).toContain("calendar you already use");
    expect(html).toContain('href="/find"');
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
    expect(html).toContain('<div id="root"></div>');

    // The full marketing page has one React source of truth; raw HTML keeps a
    // compact resilient fallback instead of a second hand-maintained hero.
    expect(html).not.toContain('class="hero-grid shell"');
  });

  it("keeps public production output free of ambiguous principal app names", () => {
    const nonHomepageFiles = publicFiles.filter((file) => file !== "index.html");
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

  it("uses shared branded shell markers on static verification pages", () => {
    for (const file of staticVerificationPages) {
      const html = readFileSync(file, "utf8");
      expect(html).toContain('data-component="GlobalHeader"');
      expect(html).toContain('data-component="GlobalFooter"');
      expect(html).toContain('href="/legal.css"');
      expect(html).toContain('href="/#how"');
      expect(html).toContain('href="/#options"');
      expect(html).not.toContain("#how-it-works");
      expect(html).not.toContain("#calendar-options");
      expect(html).toContain("Made with ❤️ by");
      expect(html).toContain('href="https://docbennyt.github.io"');
    }
  });

  it("keeps the requested public footer attribution in the React shell", () => {
    const app = readFileSync("src/AppV2.tsx", "utf8");
    expect(app).toContain("Made with ❤️ by");
    expect(app).toContain('href="https://docbennyt.github.io"');
    expect(app).not.toContain(
      "CalenderZW is the product. aiDo is the operator.",
    );
  });
});
