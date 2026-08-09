import { describe, expect, it } from "vitest";
import { generatePublishedTimetableIcs } from "../server/publishedCalendar";
import type { PublicTimetable } from "../src/api/pilotTypes";

function makeTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-1",
    publicSlug: "hit-cs-1-1-august-2026",
    institution: "Harare Institute of Technology",
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
        stableSessionKey: "stable-session-1",
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        weekday: 2,
        startTime: "14:00:00",
        endTime: "16:00:00",
        venue: "N109",
        lecturer: "Mr Mashoko",
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe("published timetable ICS generation", () => {
  it("generates recurring weekly events with prepared reminders", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [1440, 30],
    });

    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(ics).toContain("SUMMARY:ICS1102");
    expect(ics).toContain("LOCATION:N109");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261210T235959Z");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT30M");
  });

  it("keeps UID stable and increments sequence when a published session is republished", () => {
    const first = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30],
    });
    const republished = generatePublishedTimetableIcs({
      timetable: makeTimetable({
        versionNumber: 2,
        publishedAt: "2026-08-10T08:00:00.000Z",
        sessions: [
          {
            stableSessionKey: "stable-session-1",
            courseCode: "ICS1102",
            courseName: "Operating Systems",
            weekday: 2,
            startTime: "14:00:00",
            endTime: "16:00:00",
            venue: "N205",
            lecturer: "Mr Mashoko",
            sessionType: "Lecture",
            notes: null,
          },
        ],
      }),
      reminderOffsetsMinutes: [30],
    });

    expect(first).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(republished).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(first).toContain("LOCATION:N109");
    expect(republished).toContain("LOCATION:N205");
    expect(first).toContain("SEQUENCE:1");
    expect(republished).toContain("SEQUENCE:2");
  });

  it("rejects published timetables without academic period dates", () => {
    expect(() =>
      generatePublishedTimetableIcs({
        timetable: makeTimetable({ startsOn: null }),
        reminderOffsetsMinutes: [30],
      }),
    ).toThrow("Published timetable is missing academic period dates.");
  });
});
