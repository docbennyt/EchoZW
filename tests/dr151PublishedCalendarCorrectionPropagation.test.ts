import { describe, expect, it } from "vitest";
import { generatePublishedTimetableIcs } from "../server/publishedCalendar";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";

function timetable(): PublicTimetable {
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
    sessions: [
      {
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
      },
    ],
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

describe("DR-151 published calendar correction propagation", () => {
  it("projects the correction-added Tuesday class and removes the superseded Wednesday source row", () => {
    const projection = projectPublishedTimetable({ timetable: timetable() });

    expect(projection.events).toHaveLength(1);
    expect(projection.events[0]).toEqual(
      expect.objectContaining({
        stableSessionKey: "correction-a52cab41-e429-4684-b971-a87110507a55",
        weekday: 2,
        startTime: "12:15:00",
        endTime: "13:15:00",
        courseCode: "ISE4105",
      }),
    );
  });

  it("emits the effective Tuesday correction in ICS and not the removed Wednesday source UID", () => {
    const ics = generatePublishedTimetableIcs({
      timetable: timetable(),
      reminderOffsetsMinutes: [],
    });

    expect(ics).toContain(
      "UID:correction-a52cab41-e429-4684-b971-a87110507a55@calender.aido.co.zw",
    );
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;");
    expect(ics).not.toContain(
      "UID:source_778238ed6e5a0718deaa192c@calender.aido.co.zw",
    );
    expect(ics).not.toContain("RRULE:FREQ=WEEKLY;BYDAY=WE;");
  });
});
