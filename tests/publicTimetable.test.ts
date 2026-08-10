import { describe, expect, it } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import {
  buildPublicTimetableMetadata,
  formatClassGroupLabel,
  getUpcomingOccurrences,
} from "../src/domain/publicTimetable";

function makeTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-hit-1",
    publicSlug: "hit-ics-1-1-august-semester-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Computer Science",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-09T08:00:00.000Z",
    versionNumber: 1,
    sessions: [
      {
        stableSessionKey: "mon-0800",
        courseCode: "HIT1101",
        courseName: "Technopreneurship I",
        weekday: 1,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "E/HALL",
        lecturer: "TDC",
        sessionType: "Lecture",
        notes: null,
      },
      {
        stableSessionKey: "wed-1100",
        courseCode: "HCS1204",
        courseName: "Discrete Mathematics",
        weekday: 3,
        startTime: "11:00:00",
        endTime: "13:00:00",
        venue: "A1",
        lecturer: "Moyo",
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe("public timetable helpers", () => {
  it("formats a class-group label for students", () => {
    expect(formatClassGroupLabel("1.1")).toBe("Class 1.1");
    expect(formatClassGroupLabel("Class 2.2")).toBe("Class 2.2");
  });

  it("builds timetable-specific share metadata", () => {
    expect(buildPublicTimetableMetadata(makeTimetable())).toEqual({
      title: "HIT · BTech Computer Science · Class 1.1",
      description:
        "August Semester 2026 published timetable. View your classes and add them to your calendar with CalenderZW.",
      canonicalPath: "/t/hit-ics-1-1-august-semester-2026",
    });
  });

  it("derives the next relevant class inside the academic period", () => {
    const upcoming = getUpcomingOccurrences(
      makeTimetable(),
      new Date("2026-08-09T19:00:00.000Z"),
      2,
    );

    expect(upcoming).toHaveLength(2);
    expect(upcoming[0]?.relativeLabel).toBe("Tomorrow");
    expect(upcoming[0]?.session.courseName).toBe("Technopreneurship I");
    expect(upcoming[1]?.session.courseCode).toBe("HCS1204");
  });

  it("does not return future classes after the academic period ends", () => {
    const upcoming = getUpcomingOccurrences(
      makeTimetable(),
      new Date("2026-12-11T08:00:00.000Z"),
      1,
    );

    expect(upcoming).toEqual([]);
  });
});
