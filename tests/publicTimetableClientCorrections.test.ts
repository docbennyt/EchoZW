import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
import { fetchPublicTimetable } from "../src/api/publicTimetable";

function correctedTimetable(): PublicTimetable {
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
        reason: "Was omitted.",
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
        reason: "Not supposed to be here.",
        provenance: null,
        creatorRole: "class_rep",
        active: true,
        createdAt: "2026-09-29T16:30:00.000Z",
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public timetable client correction propagation", () => {
  it("preserves raw sessions, exposes the effective recurring overlay, and bypasses browser HTTP cache", async () => {
    const raw = correctedTimetable();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ timetable: raw }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const timetable = await fetchPublicTimetable(raw.publicSlug);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/timetables/${raw.publicSlug}`,
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    expect(timetable.sessions).toEqual(raw.sessions);
    expect(timetable.sessions[0]).toEqual(
      expect.objectContaining({
        stableSessionKey: "source_778238ed6e5a0718deaa192c",
        weekday: 3,
      }),
    );
    expect(timetable.effectiveSessions).toHaveLength(1);
    expect(timetable.effectiveSessions?.[0]).toEqual(
      expect.objectContaining({
        stableSessionKey: "correction-a52cab41-e429-4684-b971-a87110507a55",
        courseCode: "ISE4105",
        weekday: 2,
        startTime: "12:15:00",
        source: "correction",
      }),
    );
    expect(
      timetable.effectiveSessions?.some(
        (session) =>
          session.stableSessionKey === "source_778238ed6e5a0718deaa192c",
      ),
    ).toBe(false);
    expect(raw.sessions[0]?.weekday).toBe(3);
  });
});
