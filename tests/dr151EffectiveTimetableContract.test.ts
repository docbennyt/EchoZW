import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { generatePublishedTimetableIcs } from "../server/publishedCalendar";
import type {
  PublicTimetable,
  PublicTimetableSession,
  TimetableCorrectionDirective,
} from "../src/api/pilotTypes";
import { fetchPublicTimetable } from "../src/api/publicTimetable";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import {
  resolveRecurringSessions,
  selectEffectiveRecurringSessions,
} from "../src/domain/resolvedSchedule";

const baseSessions: PublicTimetableSession[] = [
  {
    stableSessionKey: "source-abc",
    courseCode: "ABC101",
    courseName: "Alpha Systems",
    weekday: 1,
    startTime: "08:00:00",
    endTime: "10:00:00",
    venue: "Room A",
    lecturer: "Ms Alpha",
    sessionType: "Lecture",
    notes: null,
  },
  {
    stableSessionKey: "source-ghi",
    courseCode: "GHI303",
    courseName: "Gamma Interfaces",
    weekday: 3,
    startTime: "10:00:00",
    endTime: "12:00:00",
    venue: "Room A",
    lecturer: "Dr Gamma",
    sessionType: "Lecture",
    notes: null,
  },
];

function correction(
  overrides: Partial<TimetableCorrectionDirective>,
): TimetableCorrectionDirective {
  return {
    id: "correction-id",
    stableSessionKey: null,
    action: "add",
    sourceMayReplace: false,
    pinned: true,
    courseCode: null,
    courseName: null,
    weekday: null,
    startTime: null,
    endTime: null,
    venue: null,
    lecturer: null,
    sessionType: null,
    notes: null,
    reason: "Class Rep correction",
    provenance: "Class Rep",
    creatorRole: "class_rep",
    active: true,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

function contractTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-dr151",
    publicSlug: "dr151-contract",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Reliability Engineering",
    classGroup: "4.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-09-01T08:00:00.000Z",
    versionNumber: 7,
    sessions: structuredClone(baseSessions),
    corrections: [
      correction({
        id: "remove-abc",
        action: "remove",
        stableSessionKey: "source-abc",
        sourceMayReplace: true,
        createdAt: "2026-09-01T08:01:00.000Z",
      }),
      correction({
        id: "add-def",
        action: "add",
        courseCode: "DEF202",
        courseName: "Delta Fieldwork",
        weekday: 2,
        startTime: "12:00:00",
        endTime: "13:00:00",
        venue: "Room D",
        lecturer: "Dr Delta",
        sessionType: "Lecture",
        createdAt: "2026-09-01T08:02:00.000Z",
      }),
      correction({
        id: "modify-ghi",
        action: "modify",
        stableSessionKey: "source-ghi",
        sourceMayReplace: true,
        courseCode: "GHI303",
        courseName: "Gamma Interfaces",
        weekday: 3,
        startTime: "14:00:00",
        endTime: "16:00:00",
        venue: "Room B",
        lecturer: "Dr Gamma",
        sessionType: "Lecture",
        createdAt: "2026-09-01T08:03:00.000Z",
      }),
      correction({
        id: "inactive-jkl",
        action: "add",
        courseCode: "JKL404",
        courseName: "Inactive Lecture",
        weekday: 4,
        startTime: "09:00:00",
        endTime: "10:00:00",
        venue: "Room J",
        active: false,
        createdAt: "2026-09-01T08:04:00.000Z",
      }),
      correction({
        id: "superseded-mno",
        action: "add",
        courseCode: "MNO505",
        courseName: "Superseded Lecture",
        weekday: 5,
        startTime: "09:00:00",
        endTime: "10:00:00",
        venue: "Room M",
        replacedById: "newer-mno",
        supersededAt: "2026-09-01T09:00:00.000Z",
        createdAt: "2026-09-01T08:05:00.000Z",
      }),
    ],
    ...overrides,
  };
}

function byCode(sessions: PublicTimetableSession[], code: string) {
  return sessions.filter((session) => session.courseCode === code);
}

function unfoldedIcs(timetable: PublicTimetable) {
  return generatePublishedTimetableIcs({
    timetable,
    reminderOffsetsMinutes: [],
    publicOrigin: "https://calender.aido.co.zw",
  }).replace(/\r\n[ \t]/g, "");
}

describe("DR-151 effective timetable contract", () => {
  it("keeps raw sessions immutable while resolving active add/remove/modify directives once", () => {
    const timetable = contractTimetable();
    const rawSnapshot = structuredClone(timetable.sessions);

    const effective = resolveRecurringSessions(timetable);

    expect(timetable.sessions).toEqual(rawSnapshot);
    expect(byCode(timetable.sessions, "ABC101")).toHaveLength(1);
    expect(byCode(effective, "ABC101")).toHaveLength(0);
    expect(byCode(effective, "DEF202")).toEqual([
      expect.objectContaining({
        stableSessionKey: "correction-add-def",
        weekday: 2,
        startTime: "12:00:00",
        source: "correction",
      }),
    ]);
    expect(byCode(effective, "GHI303")).toEqual([
      expect.objectContaining({
        stableSessionKey: "source-ghi",
        startTime: "14:00:00",
        endTime: "16:00:00",
        venue: "Room B",
        source: "correction",
      }),
    ]);
    expect(byCode(effective, "JKL404")).toHaveLength(0);
    expect(byCode(effective, "MNO505")).toHaveLength(0);
    expect(effective).toHaveLength(2);

    const resolvedAgain = resolveRecurringSessions({
      ...timetable,
      sessions: effective,
      effectiveSessions: undefined,
    });
    expect(byCode(resolvedAgain, "DEF202")).toHaveLength(1);
    expect(byCode(resolvedAgain, "GHI303")).toHaveLength(1);
  });

  it("selects server effectiveSessions when present and computes a compatible fallback for old backends", () => {
    const timetable = contractTimetable();
    const serverEffective = [
      {
        ...baseSessions[0],
        stableSessionKey: "server-effective",
        weekday: 6,
      },
    ];

    expect(
      selectEffectiveRecurringSessions({
        ...timetable,
        effectiveSessions: serverEffective,
      }),
    ).toEqual(serverEffective);

    expect(selectEffectiveRecurringSessions(timetable)).toEqual(
      resolveRecurringSessions(timetable),
    );
  });

  it("fetchPublicTimetable preserves raw source sessions and fills explicit effectiveSessions", async () => {
    const timetable = contractTimetable();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ timetable }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fetched = await fetchPublicTimetable(timetable.publicSlug);

    expect(fetched.sessions).toEqual(timetable.sessions);
    expect(byCode(fetched.sessions, "ABC101")).toHaveLength(1);
    expect(byCode(fetched.effectiveSessions ?? [], "ABC101")).toHaveLength(0);
    expect(byCode(fetched.effectiveSessions ?? [], "DEF202")).toHaveLength(1);
  });

  it("projects the same canonical effective truth to calendar events and ICS without duplicates", () => {
    const timetable = contractTimetable();

    const projection = projectPublishedTimetable({ timetable });
    const ics = unfoldedIcs(timetable);

    expect(byCode(projection.events, "ABC101")).toHaveLength(0);
    expect(byCode(projection.events, "DEF202")).toHaveLength(1);
    expect(byCode(projection.events, "GHI303")).toEqual([
      expect.objectContaining({
        stableSessionKey: "source-ghi",
        startTime: "14:00:00",
        venue: "Room B",
      }),
    ]);
    expect(projection.events).toHaveLength(2);
    expect(ics).not.toContain("SUMMARY:ABC101");
    expect(ics.match(/SUMMARY:DEF202/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260811T120000");
    expect(ics.match(/SUMMARY:GHI303/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260812T140000");
    expect(ics).not.toContain("DTSTART;TZID=Africa/Harare:20260812T100000");
  });

  it("keeps student-facing recurring surfaces on the explicit effective selector", () => {
    const publicClient = readFileSync("src/api/publicTimetable.ts", "utf8");
    const classRep = readFileSync(
      "src/ClassRepCorrectionSafetyEnhancement.tsx",
      "utf8",
    );
    const pause = readFileSync("src/ClassRepAcademicPauseControl.tsx", "utf8");
    const pilot = readFileSync("src/pilotMvp.tsx", "utf8");

    expect(publicClient).not.toContain("sessions: effectiveSessions");
    expect(publicClient).not.toContain(
      "sessions: selectEffectiveRecurringSessions",
    );
    expect(classRep).toContain("selectEffectiveRecurringSessions(timetable)");
    expect(pause).toContain("selectEffectiveRecurringSessions(timetable)");
    expect(pilot).toContain("selectEffectiveRecurringSessions(timetable)");
  });
});
