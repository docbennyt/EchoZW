import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repository = readFileSync("server/pilotRepository.ts", "utf8");
const publicApi = readFileSync("server/publicTimetableApi.ts", "utf8");
const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
const responsiveUx = readFileSync("src/dr66ResponsiveUx.css", "utf8");
const heroProof = readFileSync("src/HeroTrustProof.tsx", "utf8");

describe("DR-66 finder discovery contract", () => {
  it("serves only published rows with real academic-period date truth", () => {
    expect(repository).toContain("listPublishedTimetableDiscovery");
    expect(repository).toContain("institutions(name, timezone)");
    expect(repository).toContain("academic_periods(name, starts_on, ends_on)");
    expect(repository).toContain(
      '.not("current_published_version_id", "is", null)',
    );
    expect(publicApi).toContain("listPublishedTimetableDiscovery");
    expect(publicApi).toContain("startsOn: timetable.academicPeriodStartsOn");
    expect(publicApi).toContain("endsOn: timetable.academicPeriodEndsOn");
    expect(publicApi).toContain("timezone: timetable.institutionTimezone");
  });

  it("removes mobile slug/link and catalogue rails from the finder task", () => {
    expect(finder).not.toContain("SharedLinkForm");
    expect(finder).not.toContain("Timetable link or slug");
    expect(finder).not.toContain("or open a shared class link");
    expect(finder).not.toContain("czw-mobile-browse-rail");
    expect(finder).not.toContain("czw-available-section");
  });

  it("uses the post-merge responsive contract: mobile exact finder, desktop directory", () => {
    expect(responsiveUx).toContain("@media (max-width: 1023.98px)");
    expect(responsiveUx).toContain("@media (min-width: 1024px)");
    expect(responsiveUx).toContain(".czw-finder-primary");
    expect(responsiveUx).toContain("display: none !important");
    expect(responsiveUx).toContain(".czw-directory-desktop");
    expect(responsiveUx).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr))",
    );
    expect(responsiveUx).toContain(".czw-directory-category-row");
    expect(responsiveUx).toContain(".czw-directory-toolbar-actions");
  });

  it("keeps the exact mobile task in the required field order", () => {
    const exactStart = finder.indexOf("function ExactFinder");
    const exactEnd = finder.indexOf("function TimetableThumbnail");
    const exact = finder.slice(exactStart, exactEnd);
    const institution = exact.indexOf('label="Institution"');
    const programme = exact.indexOf('label="Programme"');
    const classGroup = exact.indexOf('label="Class"');
    const period = exact.indexOf('label="Academic period"');
    const submit = exact.indexOf("View timetable");
    expect(institution).toBeGreaterThan(-1);
    expect(institution).toBeLessThan(programme);
    expect(programme).toBeLessThan(classGroup);
    expect(classGroup).toBeLessThan(period);
    expect(period).toBeLessThan(submit);
  });

  it("uses real HIT identity and published timetable data instead of fabricated social proof", () => {
    expect(heroProof).toContain("https://portal.hit.ac.zw/img/HITlogo.png");
    expect(heroProof).toContain("fetchPublishedTimetables");
    expect(heroProof).toContain("publishedCount");
    expect(heroProof).not.toContain("18+ active calendar connections");
  });
});
