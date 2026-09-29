import { describe, expect, it } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import {
  getResolvedUpcomingOccurrences,
  resolveRecurringSessions,
  resolveScheduleForDate,
} from "../src/domain/resolvedSchedule";

function timetable(overrides: Partial<PublicTimetable> = {}): PublicTimetable {
  return {
    timetableId: "tt-cs-1-1",
    publicSlug: "hit-ics-1-1-august-semester-2026",
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
        stableSessionKey: "ics1102-tue-1400",
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

describe("canonical resolved schedule", () => {
  it("adds a one-off Tuesday 1 Sep 2026 extra lecture without recurring next week", () => {
    const resolved = timetable({
      exceptions: [
        {
          id: "extra-1",
          stableSessionKey: null,
          exceptionDate: "2026-09-01",
          exceptionType: "extra",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: "ICS1103",
          courseName: "Extra lecture",
          startTime: "08:00:00",
          endTime: "10:00:00",
          venue: "N111",
          lecturer: null,
          sessionType: "Lecture",
          notes: "One-off class rep update",
          reason: "Catch-up lecture",
          provenance: "Class rep",
          active: true,
          createdAt: "2026-08-31T08:00:00.000Z",
        },
      ],
    });

    const sep1 = resolveScheduleForDate(resolved, "2026-09-01");
    const sep8 = resolveScheduleForDate(resolved, "2026-09-08");

    expect(sep1.map((item) => item.session.courseName)).toContain(
      "Extra lecture",
    );
    expect(sep1[0]?.recurring).toBe(false);
    expect(sep1[0]?.start.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(sep8.map((item) => item.session.courseName)).not.toContain(
      "Extra lecture",
    );
  });

  it("feeds Tomorrow and Next Class from the same resolved occurrence stream", () => {
    const resolved = timetable({
      exceptions: [
        {
          id: "extra-1",
          stableSessionKey: null,
          exceptionDate: "2026-09-01",
          exceptionType: "extra",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: "ICS1103",
          courseName: "Extra lecture",
          startTime: "08:00:00",
          endTime: "10:00:00",
          venue: "N111",
          lecturer: null,
          sessionType: "Lecture",
          notes: null,
          reason: "Catch-up lecture",
          provenance: "Class rep",
          active: true,
          createdAt: "2026-08-31T08:00:00.000Z",
        },
      ],
    });

    const upcoming = getResolvedUpcomingOccurrences(
      resolved,
      new Date("2026-08-31T20:00:00.000Z"),
      2,
    );

    expect(upcoming[0]?.session.courseName).toBe("Extra lecture");
    expect(upcoming[1]?.session.courseCode).toBe("ICS1102");
  });

  it("keeps pinned recurring corrections active until explicitly revoked", () => {
    const resolved = timetable({
      corrections: [
        {
          id: "pinned-os-venue",
          stableSessionKey: "ics1102-tue-1400",
          action: "modify",
          sourceMayReplace: false,
          pinned: true,
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          weekday: 2,
          startTime: "14:00:00",
          endTime: "16:00:00",
          venue: "N110",
          lecturer: "Mr Mashoko",
          sessionType: "Lecture",
          notes: "Class-confirmed room",
          reason: "Lecturer moved OS to N110",
          provenance: "Class rep observed notice",
          creatorRole: "class_rep",
          active: true,
          createdAt: "2026-08-31T09:00:00.000Z",
        },
      ],
    });

    expect(resolveRecurringSessions(resolved)[0]?.venue).toBe("N110");
  });

  it("ignores revoked recurring corrections", () => {
    const resolved = timetable({
      corrections: [
        {
          id: "revoked-os-venue",
          stableSessionKey: "ics1102-tue-1400",
          action: "modify",
          sourceMayReplace: false,
          pinned: true,
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          weekday: 2,
          startTime: "14:00:00",
          endTime: "16:00:00",
          venue: "N110",
          lecturer: "Mr Mashoko",
          sessionType: "Lecture",
          notes: null,
          reason: "Old correction",
          provenance: null,
          creatorRole: "class_rep",
          active: false,
          createdAt: "2026-08-31T09:00:00.000Z",
        },
      ],
    });

    expect(resolveRecurringSessions(resolved)[0]?.venue).toBe("N109");
  });

  it("moves the production-shaped ISE4105 recurring class by overlay without rewriting source evidence", () => {
    const baseSessions = Array.from({ length: 15 }, (_, index) => ({
      stableSessionKey: `source-${index}`,
      courseCode: `ISE${4100 + index}`,
      courseName: `Course ${index}`,
      weekday: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      startTime: index % 2 === 0 ? "08:00:00" : "10:15:00",
      endTime: index % 2 === 0 ? "10:00:00" : "12:15:00",
      venue: `N${100 + index}`,
      lecturer: null,
      sessionType: "Lecture",
      notes: null,
    }));
    baseSessions[12] = {
      stableSessionKey: "source_778238ed6e5a0718deaa192c",
      courseCode: "ISE4105",
      courseName: "Software Testing & Quality Assurance",
      weekday: 3,
      startTime: "12:15:00",
      endTime: "13:15:00",
      venue: "N109",
      lecturer: "Mr Manjoro",
      sessionType: "Lecture",
      notes: null,
    };

    const sourceSnapshot = structuredClone(baseSessions);
    const resolved = timetable({
      publicSlug: "ise-part-4-1-august-semester-2026",
      sessions: baseSessions,
      corrections: [
        {
          id: "a52cab41-e429-4684-b971-a87110507a55",
          stableSessionKey: null,
          action: "add",
          sourceMayReplace: false,
          pinned: true,
          courseCode: "ISE4105",
          courseName: "Software Testing & Quality Assurance",
          weekday: 2,
          startTime: "12:15:00",
          endTime: "13:15:00",
          venue: "N109",
          lecturer: "Mr Manjoro",
          sessionType: "Lecture",
          notes: null,
          reason: "Was ommitted.",
          provenance: null,
          creatorRole: "class_rep",
          active: true,
          createdAt: "2026-09-29T16:26:05.000Z",
        },
        {
          id: "remove-source-ise4105",
          stableSessionKey: "source_778238ed6e5a0718deaa192c",
          action: "remove",
          sourceMayReplace: true,
          pinned: false,
          courseCode: null,
          courseName: null,
          weekday: null,
          startTime: null,
          endTime: null,
          venue: null,
          lecturer: null,
          sessionType: null,
          notes: null,
          reason: "not supposed to be here.",
          provenance: null,
          creatorRole: "class_rep",
          active: true,
          createdAt: "2026-09-29T16:30:00.000Z",
        },
      ],
    });

    const effective = resolveRecurringSessions(resolved);
    const ise4105 = effective.filter((session) => session.courseCode === "ISE4105");

    expect(effective).toHaveLength(15);
    expect(ise4105).toEqual([
      expect.objectContaining({
        source: "correction",
        weekday: 2,
        startTime: "12:15:00",
        endTime: "13:15:00",
        venue: "N109",
      }),
    ]);
    expect(
      effective.some(
        (session) =>
          session.stableSessionKey === "source_778238ed6e5a0718deaa192c",
      ),
    ).toBe(false);
    expect(baseSessions).toEqual(sourceSnapshot);
  });
});
