import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repository = readFileSync("server/pilotRepository.ts", "utf8");
const publicApi = readFileSync("server/publicTimetableApi.ts", "utf8");
const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");

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

  it("keeps the exact finder primary and the desktop directory explicitly secondary", () => {
    expect(finder).toContain('data-priority="primary"');
    expect(finder).toContain('data-priority="secondary"');
    const routeOwner = finder.slice(
      finder.indexOf("export function FinderDiscovery"),
    );
    expect(routeOwner.indexOf("<ExactFinder")).toBeGreaterThan(-1);
    expect(routeOwner.indexOf("<DesktopDirectory")).toBeGreaterThan(-1);
    expect(routeOwner.indexOf("<ExactFinder")).toBeLessThan(
      routeOwner.indexOf("<DesktopDirectory"),
    );
    expect(finder).toContain('isDesktop && status === "ready"');
  });

  it("keeps the exact task in the required field order", () => {
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
});
