import { describe, expect, it } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import {
  buildVTimezoneLines,
  zonedDateTimeToUtc,
} from "../src/domain/timezone";

function makeTimetable(): PublicTimetable {
  return {
    timetableId: "tt-dr42",
    publicSlug: "hit-cs-1-1-august-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Computer Science",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-09T08:00:00.000Z",
    versionNumber: 3,
    sessions: [
      {
        stableSessionKey: "hit1101-mon",
        courseCode: "HIT1101",
        courseName: "Technopreneurship I",
        weekday: 1,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "Engineering Hall",
        lecturer: "TDC",
        sessionType: "Lecture",
        notes: null,
      },
    ],
  };
}

describe("DR-42 IANA timezone and reminder invariants", () => {
  it("maps Harare wall-clock time to UTC without changing the local lecture time", () => {
    expect(
      zonedDateTimeToUtc(
        "2026-08-31",
        "08:00:00",
        "Africa/Harare",
      ).toISOString(),
    ).toBe("2026-08-31T06:00:00.000Z");

    const projected = projectPublishedTimetable({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30],
    });
    expect(projected.events[0].startTime).toBe("08:00:00");
    expect(projected.events[0].alarms).toEqual([
      {
        minutesBefore: 30,
        description: "Technopreneurship I starts in 30 minutes",
      },
    ]);
  });

  it("uses actual IANA DST rules rather than a Zimbabwe-only fixed offset", () => {
    expect(
      zonedDateTimeToUtc(
        "2026-01-15",
        "08:00:00",
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-01-15T08:00:00.000Z");
    expect(
      zonedDateTimeToUtc(
        "2026-07-15",
        "08:00:00",
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-07-15T07:00:00.000Z");

    const timezone = buildVTimezoneLines(
      "Europe/London",
      "2026-01-01",
      "2026-12-31",
    ).join("\r\n");
    expect(timezone).toContain("BEGIN:VTIMEZONE");
    expect(timezone).toContain("TZID:Europe/London");
    expect(timezone).toContain("TZOFFSETFROM:+0000");
    expect(timezone).toContain("TZOFFSETTO:+0100");
    expect(timezone).toContain("TZOFFSETFROM:+0100");
    expect(timezone).toContain("TZOFFSETTO:+0000");
    expect(timezone).toContain("END:VTIMEZONE");
  });

  it("deduplicates reminders without altering event timing", () => {
    const projected = projectPublishedTimetable({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30, 30, 15, 60, 15],
    });
    const event = projected.events[0];

    expect(event.localStart).toBe("20260810T080000");
    expect(event.localEnd).toBe("20260810T100000");
    expect(event.alarms.map((alarm) => alarm.minutesBefore)).toEqual([
      60,
      30,
      15,
    ]);
  });
});
