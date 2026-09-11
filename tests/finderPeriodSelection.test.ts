import { describe, expect, it } from "vitest";
import type { PublishedTimetableSummary } from "../src/api/publicDiscovery";
import {
  chooseAcademicPeriod,
  institutionLocalDate,
  isAcademicPeriodCurrent,
} from "../src/domain/finderPeriodSelection";

function period(
  name: string,
  startsOn: string | null,
  endsOn: string | null,
  timezone = "Africa/Harare",
): PublishedTimetableSummary {
  return {
    publicSlug: name.toLowerCase().replace(/\s+/g, "-"),
    institutionName: "Harare Institute of Technology",
    timezone,
    programmeName: "BTech Computer Science",
    classGroupLabel: "1.1",
    academicPeriodName: name,
    startsOn,
    endsOn,
    lastUpdated: "2026-09-11T08:00:00.000Z",
  };
}

describe("finder academic-period selection", () => {
  it("selects the only compatible published period without pretending it is current", () => {
    expect(
      chooseAcademicPeriod(
        [period("January Semester 2026", "2026-01-05", "2026-05-01")],
        new Date("2026-09-11T10:00:00.000Z"),
      ),
    ).toEqual({
      selectedPeriodName: "January Semester 2026",
      reason: "single",
    });
  });

  it("selects the unique period containing today's institution-local date", () => {
    expect(
      chooseAcademicPeriod(
        [
          period("January Semester 2026", "2026-01-05", "2026-05-01"),
          period("August Semester 2026", "2026-08-10", "2026-12-10"),
        ],
        new Date("2026-09-11T10:00:00.000Z"),
      ),
    ).toEqual({
      selectedPeriodName: "August Semester 2026",
      reason: "current",
    });
  });

  it("requires an explicit choice when no period contains today's date", () => {
    expect(
      chooseAcademicPeriod(
        [
          period("January Semester 2026", "2026-01-05", "2026-05-01"),
          period("January Semester 2027", "2027-01-04", "2027-05-01"),
        ],
        new Date("2026-09-11T10:00:00.000Z"),
      ),
    ).toEqual({ selectedPeriodName: null, reason: "ambiguous" });
  });

  it("requires an explicit choice when published periods overlap", () => {
    expect(
      chooseAcademicPeriod(
        [
          period("August Semester 2026", "2026-08-10", "2026-12-10"),
          period("Special Block 2026", "2026-09-01", "2026-09-30"),
        ],
        new Date("2026-09-11T10:00:00.000Z"),
      ),
    ).toEqual({ selectedPeriodName: null, reason: "overlap" });
  });

  it("uses the institution timezone at UTC date boundaries", () => {
    const now = new Date("2026-09-10T22:30:00.000Z");
    expect(institutionLocalDate(now, "Africa/Harare")).toBe("2026-09-11");
    expect(
      isAcademicPeriodCurrent(
        period("One day", "2026-09-11", "2026-09-11"),
        now,
      ),
    ).toBe(true);
  });

  it("fails closed for missing dates, reversed ranges and invalid timezones", () => {
    const now = new Date("2026-09-11T10:00:00.000Z");
    expect(isAcademicPeriodCurrent(period("Missing", null, null), now)).toBe(
      false,
    );
    expect(
      isAcademicPeriodCurrent(
        period("Reversed", "2026-12-10", "2026-08-10"),
        now,
      ),
    ).toBe(false);
    expect(
      isAcademicPeriodCurrent(
        period("Invalid zone", "2026-08-10", "2026-12-10", "Not/AZone"),
        now,
      ),
    ).toBe(false);
  });
});
