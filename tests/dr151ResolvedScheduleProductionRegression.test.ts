import { describe, expect, it } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { resolveRecurringSessions } from "../src/domain/resolvedSchedule";

function makeTimetable(): PublicTimetable {
  const sessions: PublicTimetable["sessions"] = Array.from(
    { length: 15 },
    (_, index) => ({
      stableSessionKey: `source-${index}`,
      courseCode: `ISE${4100 + index}`,
      courseName: `Course ${index}`,
      weekday: (index % 5) + 1,
      startTime: index % 2 === 0 ? "08:00:00" : "10:15:00",
      endTime: index % 2 === 0 ? "10:00:00" : "12:15:00",
      venue: `N${100 + index}`,
      lecturer: null,
      sessionType: "Lecture",
      notes: null,
    }),
  );

  sessions[12] = {
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

  return {
    timetableId: "08a30b9b-ed8f-4aea-91de-09d4e1124f9a",
    publicSlug: "ise-part-4-1-august-semester-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Software Engineering",
    classGroup: "4.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-09-01T08:00:00.000Z",
    versionNumber: 4,
    sessions,
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
  };
}

describe("DR-151 production recurring correction regression", () => {
  it("moves ISE4105 from Wednesday to Tuesday without rewriting source evidence", () => {
    const timetable = makeTimetable();
    const sourceSnapshot = structuredClone(timetable.sessions);

    const effective = resolveRecurringSessions(timetable);
    const ise4105 = effective.filter((session) => session.courseCode === "ISE4105");

    expect(effective).toHaveLength(15);
    expect(ise4105).toEqual([
      expect.objectContaining({
        stableSessionKey: "correction-a52cab41-e429-4684-b971-a87110507a55",
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
    expect(timetable.sessions).toEqual(sourceSnapshot);
  });
});
