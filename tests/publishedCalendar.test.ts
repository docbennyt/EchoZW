import { describe, expect, it } from "vitest";
import { generatePublishedTimetableIcs } from "../server/publishedCalendar";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import {
  foldIcsLineUtf8,
  zonedDateTimeToUtc,
} from "../src/domain/timezone";

function unfoldIcs(value: string) {
  return value.replace(/\r\n[ \t]/g, "");
}

function makeTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-1",
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
    versionNumber: 1,
    sessions: [
      {
        stableSessionKey: "stable-session-1",
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
    ...overrides,
  };
}

describe("published timetable ICS generation", () => {
  it("preserves 08:00 Africa/Harare wall-clock time while mapping the instant to 06:00Z", () => {
    const timetable = makeTimetable();
    const projection = projectPublishedTimetable({
      timetable,
      reminderOffsetsMinutes: [30],
      publicOrigin: "https://calender.aido.co.zw",
    });
    const event = projection.events[0];
    const ics = generatePublishedTimetableIcs({
      timetable,
      reminderOffsetsMinutes: [30],
      publicOrigin: "https://calender.aido.co.zw",
    });

    expect(event.startTime).toBe("08:00:00");
    expect(event.firstStartUtc).toBe("2026-08-10T06:00:00.000Z");
    expect(
      zonedDateTimeToUtc(
        "2026-08-10",
        "08:00:00",
        "Africa/Harare",
      ).toISOString(),
    ).toBe("2026-08-10T06:00:00.000Z");
    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260810T080000");
    expect(ics).toContain("DTEND;TZID=Africa/Harare:20260810T100000");
    expect(ics).not.toContain("DTSTART;TZID=Africa/Harare:20260810T060000");
    expect(ics).not.toContain("DTSTART:20260810T080000Z");
  });

  it("embeds standards-useful timezone data for the institution IANA zone", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30],
    });

    expect(ics).toContain("BEGIN:VTIMEZONE\r\n");
    expect(ics).toContain("TZID:Africa/Harare\r\n");
    expect(ics).toContain("X-LIC-LOCATION:Africa/Harare\r\n");
    expect(ics).toContain("TZOFFSETFROM:+0200\r\n");
    expect(ics).toContain("TZOFFSETTO:+0200\r\n");
    expect(ics).toContain("END:VTIMEZONE\r\n");
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
  });

  it("keeps reminders in VALARM without moving lecture DTSTART or DTEND", () => {
    const timetable = makeTimetable();
    const cases = [[30], [1440, 30], [60, 15], [125]];

    for (const reminders of cases) {
      const ics = generatePublishedTimetableIcs({
        timetable,
        reminderOffsetsMinutes: reminders,
      });
      expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260810T080000");
      expect(ics).toContain("DTEND;TZID=Africa/Harare:20260810T100000");
      for (const minutes of reminders) {
        expect(ics).toContain(`TRIGGER:-PT${minutes}M`);
      }
    }
  });

  it("deduplicates reminder offsets without changing the event wall-clock time", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30, 30, 60, 15, 15],
    });

    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260810T080000");
    expect(ics).toContain("DTEND;TZID=Africa/Harare:20260810T100000");
    expect(ics.match(/TRIGGER:-PT30M/g)).toHaveLength(1);
    expect(ics.match(/TRIGGER:-PT60M/g)).toHaveLength(1);
    expect(ics.match(/TRIGGER:-PT15M/g)).toHaveLength(1);
  });

  it("converts the academic-period recurrence boundary from local end-of-day to UTC", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30],
    });

    expect(ics).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261210T215959Z",
    );
    expect(ics).not.toContain("UNTIL=20261210T235959Z");
  });

  it("keeps UID stable and increments sequence when venue changes on the same logical session", () => {
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
            ...makeTimetable().sessions[0],
            venue: "N205",
          },
        ],
      }),
      reminderOffsetsMinutes: [30],
    });

    expect(first).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(republished).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(first).toContain("LOCATION:Engineering Hall");
    expect(republished).toContain("LOCATION:N205");
    expect(first).toContain("SEQUENCE:1");
    expect(republished).toContain("SEQUENCE:2");
    expect(republished).toContain("LAST-MODIFIED:20260810T080000Z");
  });

  it("keeps UID stable when a trusted republish changes local time", () => {
    const republished = generatePublishedTimetableIcs({
      timetable: makeTimetable({
        versionNumber: 2,
        publishedAt: "2026-08-10T08:00:00.000Z",
        sessions: [
          {
            ...makeTimetable().sessions[0],
            startTime: "09:00:00",
            endTime: "11:00:00",
          },
        ],
      }),
      reminderOffsetsMinutes: [30],
    });

    expect(republished).toContain("UID:stable-session-1@calender.aido.co.zw");
    expect(republished).toContain("DTSTART;TZID=Africa/Harare:20260810T090000");
    expect(republished).toContain("DTEND;TZID=Africa/Harare:20260810T110000");
    expect(republished).toContain("SEQUENCE:2");
  });

  it("projects public timetable fields and feed fields from the same session data", () => {
    const timetable = makeTimetable();
    const projection = projectPublishedTimetable({ timetable });
    const event = projection.events[0];
    const session = timetable.sessions[0];

    expect(event.stableSessionKey).toBe(session.stableSessionKey);
    expect(event.weekday).toBe(session.weekday);
    expect(event.startTime).toBe(session.startTime);
    expect(event.endTime).toBe(session.endTime);
    expect(event.courseCode).toBe(session.courseCode);
    expect(event.venue).toBe(session.venue);
  });

  it("puts only the public timetable URL in event descriptions, never a private feed URL", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: makeTimetable(),
      reminderOffsetsMinutes: [30],
      publicOrigin: "https://calender.aido.co.zw",
    });
    const logicalIcs = unfoldIcs(ics);

    expect(logicalIcs).toContain(
      "CalenderZW timetable: https://calender.aido.co.zw/t/hit-cs-1-1-august-2026",
    );
    expect(logicalIcs).not.toContain("/calendar/feed/");
    expect(logicalIcs).not.toContain("private-test-token");
  });

  it("uses CRLF and folds physical lines by UTF-8 octets without changing logical content", () => {
    const timetable = makeTimetable({
      sessions: [
        {
          ...makeTimetable().sessions[0],
          notes: "Campus update ".repeat(12) + "📚📚📚",
        },
      ],
    });
    const ics = generatePublishedTimetableIcs({
      timetable,
      reminderOffsetsMinutes: [30],
    });

    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    for (const line of ics.split("\r\n").filter(Boolean)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }

    const logicalLine =
      "DESCRIPTION:Zimbabwe ❤️ timetable café 📚 Mañana ".repeat(5);
    const folded = foldIcsLineUtf8(logicalLine);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfoldIcs(folded)).toBe(logicalLine);
  });

  it("rejects missing publication dates, missing period dates, invalid zones, and invalid time ranges", () => {
    expect(() =>
      generatePublishedTimetableIcs({
        timetable: makeTimetable({ startsOn: null }),
        reminderOffsetsMinutes: [30],
      }),
    ).toThrow("Published timetable is missing academic period dates.");

    expect(() =>
      generatePublishedTimetableIcs({
        timetable: makeTimetable({ publishedAt: null }),
        reminderOffsetsMinutes: [30],
      }),
    ).toThrow("Published timetable is missing publication timestamp.");

    expect(() =>
      generatePublishedTimetableIcs({
        timetable: makeTimetable({ institutionTimezone: "Mars/Olympus" }),
        reminderOffsetsMinutes: [30],
      }),
    ).toThrow("Unsupported institution timezone");

    expect(() =>
      generatePublishedTimetableIcs({
        timetable: makeTimetable({
          sessions: [
            {
              ...makeTimetable().sessions[0],
              startTime: "10:00:00",
              endTime: "08:00:00",
            },
          ],
        }),
        reminderOffsetsMinutes: [30],
      }),
    ).toThrow("must end after it starts");
  });
});
