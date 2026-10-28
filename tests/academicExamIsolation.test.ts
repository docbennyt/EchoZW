import { describe, expect, it } from "vitest";
import type {
  AcademicSchedulePause,
  PublicTimetable,
  TimetableSessionException,
} from "../src/api/pilotTypes";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import { resolveScheduleForDate } from "../src/domain/resolvedSchedule";

function lecturePause(): AcademicSchedulePause {
  return {
    id: "lecture-period-ended",
    scopeType: "institution",
    stableSessionKey: null,
    startsOn: "2026-10-26",
    endsOn: "2026-11-30",
    allDay: true,
    startsAt: null,
    endsAt: null,
    reason: "other",
    label: "Lectures paused during examinations",
    active: true,
    createdAt: "2026-10-26T08:00:00.000Z",
  };
}

function exam(
  overrides: Partial<TimetableSessionException> = {},
): TimetableSessionException {
  return {
    id: "published-exam-root",
    stableSessionKey: null,
    exceptionDate: "2026-11-02",
    exceptionType: "extra",
    replacementStartsAt: null,
    replacementEndsAt: null,
    courseCode: "SE4101",
    courseName: "Software Engineering",
    startTime: "09:00:00",
    endTime: "12:00:00",
    venue: "Exam Hall",
    lecturer: null,
    sessionType: "Examination",
    notes: null,
    reason: "Published examination timetable",
    provenance: "Reviewed exam publication",
    active: true,
    createdAt: "2026-10-27T08:00:00.000Z",
    ...overrides,
  };
}

function timetable(overrides: Partial<PublicTimetable> = {}): PublicTimetable {
  return {
    timetableId: "hit-se41-2026",
    publicSlug: "hit-se41-august-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "Software Engineering",
    classGroup: "4.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-10-19",
    endsOn: "2026-12-07",
    publishedAt: "2026-10-27T08:00:00.000Z",
    versionNumber: 1,
    sessions: [
      {
        stableSessionKey: "se4101-monday",
        courseCode: "SE4101",
        courseName: "Software Engineering",
        weekday: 1,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "Lecture Hall",
        lecturer: null,
        sessionType: "Lecture",
        notes: null,
      },
    ],
    exceptions: [exam()],
    pauses: [lecturePause()],
    ...overrides,
  };
}

function project(
  value: PublicTimetable,
  lectureReminders: number[] = [],
  examReminders?: number[],
) {
  const input = {
    timetable: value,
    reminderOffsetsMinutes: lectureReminders,
    examReminderOffsetsMinutes: examReminders,
  };
  return projectPublishedTimetable(input);
}

function projectedExam(
  value: PublicTimetable,
  lectureReminders: number[] = [],
  examReminders?: number[],
) {
  return project(value, lectureReminders, examReminders).events.find(
    (event) => !event.recurring,
  );
}

describe("DR-178 independently published examinations", () => {
  it("suppresses paused lectures while retaining the independently dated Nov 2 exam", () => {
    const value = timetable();
    const original = structuredClone(value);
    const occurrences = resolveScheduleForDate(value, "2026-11-02");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      dateKey: "2026-11-02",
      recurring: false,
      session: {
        stableSessionKey: "exam:extra-published-exam-root",
        sessionType: "Examination",
      },
    });
    expect(occurrences[0].start.toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(resolveScheduleForDate(value, "2026-10-26")).toEqual([]);
    expect(resolveScheduleForDate(value, "2026-11-30")).toEqual([]);
    expect(resolveScheduleForDate(value, "2026-12-07")).toHaveLength(1);
    expect(value).toEqual(original);
  });

  it("projects lecture exclusions and a single non-recurring exam in the same feed", () => {
    const result = project(timetable(), [30], [1440, 60]);
    const lecture = result.events.find((event) => event.recurring);
    expect(lecture?.stableSessionKey).toBe("se4101-monday");
    expect(lecture?.uid).toBe("se4101-monday@calender.aido.co.zw");
    expect(lecture?.exDates).toContain("2026-11-02");
    expect(lecture?.alarms.map((alarm) => alarm.minutesBefore)).toEqual([30]);
    expect(result.events.filter((event) => !event.recurring)).toHaveLength(1);
    expect(result.events.find((event) => !event.recurring)).toMatchObject({
      stableSessionKey: "exam:extra-published-exam-root",
      uid: "exam:extra-published-exam-root@calender.aido.co.zw",
      exceptionDate: "2026-11-02",
      firstStartUtc: "2026-11-02T07:00:00.000Z",
      exDates: [],
    });
  });

  it("does not inherit lecture reminders when exam reminders are unspecified", () => {
    const event = projectedExam(timetable({ pauses: [] }), [1440, 30]);
    expect(event).toBeDefined();
    expect(event?.alarms).toEqual([]);
  });

  it("uses independent deduplicated exam reminders without changing start time", () => {
    const value = timetable({ pauses: [] });
    const first = projectedExam(value, [30], [1440, 60, 60, 0, -10, 1.5]);
    const changedLectures = projectedExam(value, [15], [1440, 60]);
    expect(first?.alarms.map((alarm) => alarm.minutesBefore)).toEqual([
      1440, 60,
    ]);
    expect(changedLectures?.alarms).toEqual(first?.alarms);
    expect(changedLectures?.firstStartUtc).toBe("2026-11-02T07:00:00.000Z");
    expect(projectedExam(value, [30], [])?.alarms).toEqual([]);
  });

  it.each(["Exam", "Examination", "Assessment"])(
    "recognizes the explicit %s session type during a lecture pause",
    (sessionType) => {
      expect(
        resolveScheduleForDate(
          timetable({ exceptions: [exam({ sessionType })] }),
          "2026-11-02",
        ),
      ).toHaveLength(1);
    },
  );

  it.each(["Lecture", "Exam preparation", "Examination tutorial", null])(
    "does not exempt %s extra sessions based on course title or free text",
    (sessionType) => {
      const value = timetable({
        exceptions: [
          exam({
            sessionType,
            courseName: "Examination",
            notes: "Exam tomorrow",
          }),
        ],
      });
      expect(resolveScheduleForDate(value, "2026-11-02")).toEqual([]);
    },
  );

  it("keeps exam identity and reminders stable when lecture pauses and corrections change", () => {
    const firstValue = timetable({ pauses: [] });
    const first = projectedExam(firstValue, [30], [60]);
    const changed = timetable({
      versionNumber: 2,
      pauses: [{ ...lecturePause(), endsOn: "2026-12-01" }],
      corrections: [
        {
          id: "lecture-room-correction",
          stableSessionKey: "se4101-monday",
          action: "modify",
          sourceMayReplace: false,
          pinned: true,
          courseCode: "SE4101",
          courseName: "Software Engineering",
          weekday: 1,
          startTime: "08:00:00",
          endTime: "10:00:00",
          venue: "Corrected lecture room",
          lecturer: null,
          sessionType: "Lecture",
          notes: null,
          reason: "Reviewed lecture correction",
          provenance: "Class rep",
          active: true,
          createdAt: "2026-10-28T08:00:00.000Z",
        },
      ],
    });
    const changedEvent = projectedExam(changed, [15], [60]);
    expect(first?.stableSessionKey).toBe("exam:extra-published-exam-root");
    expect(changedEvent?.uid).toBe(first?.uid);
    expect(changedEvent?.alarms).toEqual(first?.alarms);
    expect(changedEvent?.venue).toBe("Exam Hall");
    expect(changed.sessions).toEqual(firstValue.sessions);
    expect(changed.corrections?.[0].venue).toBe("Corrected lecture room");
  });

  it("retains the root exam identity across a replacement chain with inactive history", () => {
    const root = exam({
      active: false,
      replacedById: "exam-revision-2",
      supersededAt: "2026-10-28T08:00:00.000Z",
    });
    const second = exam({
      id: "exam-revision-2",
      active: false,
      supersedesId: root.id,
      replacedById: "exam-revision-3",
      supersededAt: "2026-10-29T08:00:00.000Z",
      revision: 2,
    });
    const latest = exam({
      id: "exam-revision-3",
      supersedesId: second.id,
      revision: 3,
      exceptionDate: "2026-11-03",
      startTime: "10:00:00",
      endTime: "13:00:00",
      venue: "Revised Exam Hall",
    });
    const value = timetable({
      exceptions: [latest, root, second],
      versionNumber: 3,
    });
    const occurrences = resolveScheduleForDate(value, "2026-11-03");
    expect(resolveScheduleForDate(value, "2026-11-02")).toEqual([]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].session.stableSessionKey).toBe(
      "exam:extra-published-exam-root",
    );
    const event = projectedExam(value, [30], [60]);
    expect(event?.uid).toBe(
      "exam:extra-published-exam-root@calender.aido.co.zw",
    );
    expect(event?.firstStartUtc).toBe("2026-11-03T08:00:00.000Z");
    expect(event?.venue).toBe("Revised Exam Hall");
    expect(event?.sequence).toBe(3);
    expect(
      project(value).events.filter((item) => !item.recurring),
    ).toHaveLength(1);
  });

  it("fails closed when a replacement exam is missing its ancestor history", () => {
    const value = timetable({
      exceptions: [exam({ id: "latest-exam", supersedesId: "missing-root" })],
    });
    expect(() => resolveScheduleForDate(value, "2026-11-02")).toThrow(
      "EXAM_IDENTITY_HISTORY_UNAVAILABLE",
    );
    expect(() => project(value)).toThrow("EXAM_IDENTITY_HISTORY_UNAVAILABLE");
  });

  it("fails closed on cyclic exam replacement history", () => {
    const value = timetable({
      exceptions: [
        exam({ id: "exam-a", supersedesId: "exam-b" }),
        exam({ id: "exam-b", supersedesId: "exam-a", active: false }),
      ],
    });
    expect(() => resolveScheduleForDate(value, "2026-11-02")).toThrow(
      "EXAM_IDENTITY_HISTORY_INVALID",
    );
    expect(() => project(value)).toThrow("EXAM_IDENTITY_HISTORY_INVALID");
  });

  it("rejects recurring examinations because exams must have an explicit published date", () => {
    const value = timetable();
    value.sessions = [{ ...value.sessions[0], sessionType: "Examination" }];
    expect(() => project(value)).toThrow(
      "Examinations require explicitly dated sessions",
    );
  });

  it("keeps exam identity when a supplied new source version replaces lecture sessions", () => {
    const before = timetable();
    const after = timetable({
      versionNumber: 2,
      publishedAt: "2026-10-28T09:00:00.000Z",
      sessions: [
        {
          ...before.sessions[0],
          stableSessionKey: "source-v2-lecture",
          startTime: "13:00:00",
          endTime: "15:00:00",
          venue: "New lecture hall",
        },
      ],
      exceptions: structuredClone(before.exceptions),
    });
    const originalExam = projectedExam(before, [30], [60]);
    const nextExam = projectedExam(after, [15], [60]);
    expect(originalExam).toBeDefined();
    expect(nextExam).toMatchObject({
      uid: originalExam?.uid,
      stableSessionKey: "exam:extra-published-exam-root",
      firstStartUtc: originalExam?.firstStartUtc,
      venue: "Exam Hall",
      alarms: originalExam?.alarms,
      sequence: 2,
    });
    expect(
      project(after).events.find((event) => event.recurring)?.stableSessionKey,
    ).toBe("source-v2-lecture");
  });

  it("honors the supplied term boundary and timezone without sharing another cohort's exam", () => {
    const other = timetable({
      timetableId: "other-institution-cohort",
      publicSlug: "other-class",
      institution: "Other institution",
      classGroup: "2.1",
      institutionTimezone: "Africa/Nairobi",
      pauses: [],
      exceptions: [],
    });
    expect(project(other).events.some((event) => !event.recurring)).toBe(false);
    const nairobi = timetable({
      institutionTimezone: "Africa/Nairobi",
      pauses: [],
    });
    expect(projectedExam(nairobi)?.firstStartUtc).toBe(
      "2026-11-02T06:00:00.000Z",
    );
    const endedTerm = timetable({ endsOn: "2026-11-01" });
    expect(resolveScheduleForDate(endedTerm, "2026-11-02")).toEqual([]);
    expect(project(endedTerm).events.some((event) => !event.recurring)).toBe(
      false,
    );
  });
});
