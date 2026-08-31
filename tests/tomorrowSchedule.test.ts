import { describe, expect, it } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { getTomorrowSchedule } from "../src/domain/tomorrowSchedule";

function timetable(overrides: Partial<PublicTimetable> = {}): PublicTimetable {
  return {
    timetableId: "tt-1",
    publicSlug: "test",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Computer Science",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-29T08:00:00.000Z",
    versionNumber: 4,
    sessions: [
      {
        stableSessionKey: "ics1101-tue-0800",
        courseCode: "ICS1101",
        courseName: "Programming Languages",
        weekday: 2,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "N205",
        lecturer: null,
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe("getTomorrowSchedule", () => {
  it("uses the institution civil date rather than the runtime timezone", () => {
    // 21:30Z on Monday is already 23:30 Monday in Harare.
    const result = getTomorrowSchedule(
      timetable(),
      new Date("2026-08-31T21:30:00.000Z"),
    );

    expect(result.institutionDateToday).toBe("2026-08-31");
    expect(result.institutionDateTomorrow).toBe("2026-09-01");
    expect(result.tomorrowWeekday).toBe(2);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.session.courseCode).toBe("ICS1101");
    expect(result.sessions[0]?.start.toISOString()).toBe(
      "2026-09-01T06:00:00.000Z",
    );
  });

  it("crosses Sunday to Monday correctly", () => {
    const result = getTomorrowSchedule(
      timetable({
        sessions: [
          {
            stableSessionKey: "mon-0800",
            courseCode: "HIT1101",
            courseName: "Technopreneurship I",
            weekday: 1,
            startTime: "08:00:00",
            endTime: "10:00:00",
            venue: "Engineering Hall",
            lecturer: null,
            sessionType: "Lecture",
            notes: null,
          },
        ],
      }),
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(result.institutionDateTomorrow).toBe("2026-08-31");
    expect(result.tomorrowWeekday).toBe(1);
    expect(result.sessions[0]?.session.courseCode).toBe("HIT1101");
  });

  it("returns no sessions when tomorrow falls outside the academic period", () => {
    const result = getTomorrowSchedule(
      timetable({ endsOn: "2026-08-31" }),
      new Date("2026-08-31T12:00:00.000Z"),
    );

    expect(result.institutionDateTomorrow).toBe("2026-09-01");
    expect(result.sessions).toEqual([]);
  });
});
