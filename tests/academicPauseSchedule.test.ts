import { describe, expect, it } from "vitest";
import type {
  AcademicSchedulePause,
  PublicTimetable,
} from "../src/api/pilotTypes";
import { getUpcomingOccurrences } from "../src/domain/publicTimetable";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import {
  resolveScheduleForDate,
  resolveScheduleForDateDetailed,
} from "../src/domain/resolvedSchedule";
import { getTomorrowSchedule } from "../src/domain/tomorrowSchedule";

function pause(
  overrides: Partial<AcademicSchedulePause> = {},
): AcademicSchedulePause {
  return {
    id: "pause-sim-break",
    scopeType: "institution",
    stableSessionKey: null,
    startsOn: "2026-09-14",
    endsOn: "2026-09-18",
    allDay: true,
    startsAt: null,
    endsAt: null,
    reason: "sim_break",
    label: "Sim Break",
    active: true,
    createdAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

function timetable(overrides: Partial<PublicTimetable> = {}): PublicTimetable {
  return {
    timetableId: "tt-hit-1-1",
    publicSlug: "hit-ics-1-1-august-semester-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Computer Science",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-03",
    endsOn: "2026-12-04",
    publishedAt: "2026-09-08T12:00:00.000Z",
    versionNumber: 5,
    sessions: [
      {
        stableSessionKey: "ics1101-mon-0800",
        courseCode: "ICS1101",
        courseName: "Programming",
        weekday: 1,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "N101",
        lecturer: null,
        sessionType: "Lecture",
        notes: null,
      },
      {
        stableSessionKey: "ics1102-mon-1400",
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        weekday: 1,
        startTime: "14:00:00",
        endTime: "16:00:00",
        venue: "N109",
        lecturer: null,
        sessionType: "Lecture",
        notes: null,
      },
      {
        stableSessionKey: "ics1103-tue-0800",
        courseCode: "ICS1103",
        courseName: "Discrete Mathematics",
        weekday: 2,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "N111",
        lecturer: null,
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe("DR-58 academic pause resolution", () => {
  it("suppresses a whole Sim Break without deleting the recurring classes", () => {
    const value = timetable({ pauses: [pause()] });

    expect(resolveScheduleForDate(value, "2026-09-14")).toEqual([]);
    expect(resolveScheduleForDate(value, "2026-09-15")).toEqual([]);
    expect(value.sessions).toHaveLength(3);
    expect(resolveScheduleForDate(value, "2026-09-21")).toHaveLength(2);
  });

  it("feeds Next Class and Tomorrow from the same pause-aware resolver", () => {
    const value = timetable({ pauses: [pause()] });
    const sundayBeforeBreak = new Date("2026-09-13T10:00:00.000Z");

    expect(getTomorrowSchedule(value, sundayBeforeBreak).sessions).toEqual([]);
    const next = getUpcomingOccurrences(value, sundayBeforeBreak, 1)[0];
    expect(next?.dateKey).toBe("2026-09-21");
    expect(next?.session.courseCode).toBe("ICS1101");
  });

  it("supports a session-only pause while leaving the other class active", () => {
    const value = timetable({
      pauses: [
        pause({
          id: "pause-os",
          scopeType: "session",
          stableSessionKey: "ics1102-mon-1400",
          startsOn: "2026-09-14",
          endsOn: "2026-09-14",
          reason: "other",
          label: "OS guest lecturer unavailable",
        }),
      ],
    });

    expect(
      resolveScheduleForDate(value, "2026-09-14").map(
        (item) => item.session.courseCode,
      ),
    ).toEqual(["ICS1101"]);
  });

  it("uses deterministic specificity for the human-facing reason when pauses overlap", () => {
    const value = timetable({
      pauses: [
        pause({ id: "institution", label: "Institution closure" }),
        pause({
          id: "timetable",
          scopeType: "timetable",
          label: "Class-specific break",
          createdAt: "2026-09-07T12:00:00.000Z",
        }),
      ],
    });

    const detailed = resolveScheduleForDateDetailed(value, "2026-09-14");
    expect(detailed.occurrences).toEqual([]);
    expect(detailed.suppressed).toHaveLength(2);
    expect(detailed.suppressed[0]?.pause.id).toBe("timetable");
  });

  it("supports a bounded closure without suppressing a morning lecture", () => {
    const value = timetable({
      pauses: [
        pause({
          id: "graduation-afternoon",
          startsOn: "2026-09-14",
          endsOn: "2026-09-14",
          allDay: false,
          startsAt: "2026-09-14T10:00:00.000Z",
          endsAt: "2026-09-14T15:00:00.000Z",
          reason: "graduation",
          label: "Graduation ceremony",
        }),
      ],
    });

    expect(
      resolveScheduleForDate(value, "2026-09-14").map(
        (item) => item.session.courseCode,
      ),
    ).toEqual(["ICS1101"]);
  });

  it("restores recurring classes automatically when a pause expires or is inactive", () => {
    const inactive = timetable({ pauses: [pause({ active: false })] });
    expect(resolveScheduleForDate(inactive, "2026-09-14")).toHaveLength(2);

    const active = timetable({ pauses: [pause()] });
    expect(resolveScheduleForDate(active, "2026-09-21")).toHaveLength(2);
  });

  it("suppresses one-off extra classes during an institution closure", () => {
    const value = timetable({
      pauses: [pause()],
      exceptions: [
        {
          id: "extra-break-class",
          stableSessionKey: null,
          exceptionDate: "2026-09-15",
          exceptionType: "extra",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: "ICS1199",
          courseName: "Catch-up",
          startTime: "12:00:00",
          endTime: "13:00:00",
          venue: "N100",
          lecturer: null,
          sessionType: "Lecture",
          notes: null,
          reason: "Catch-up",
          provenance: "Class rep",
          active: true,
          createdAt: "2026-09-10T10:00:00.000Z",
        },
      ],
    });

    expect(resolveScheduleForDate(value, "2026-09-15")).toEqual([]);
  });

  it("projects pause dates into recurring calendar EXDATEs so existing subscriptions stop firing", () => {
    const projected = projectPublishedTimetable({
      timetable: timetable({ pauses: [pause()] }),
      reminderOffsetsMinutes: [1440, 30],
    });
    const programming = projected.events.find(
      (event) => event.stableSessionKey === "ics1101-mon-0800",
    );
    const os = projected.events.find(
      (event) => event.stableSessionKey === "ics1102-mon-1400",
    );

    expect(programming?.exDates).toContain("2026-09-14");
    expect(os?.exDates).toContain("2026-09-14");
    expect(programming?.alarms.map((alarm) => alarm.minutesBefore)).toEqual([
      1440,
      30,
    ]);
  });
});
