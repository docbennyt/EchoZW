import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublishedTimetableDiscovery = vi.fn();
const getPublishedTimetableBySlug = vi.fn();
const getTimetablePublicDisplaySettings = vi.fn();
const resolveRecurringSessions = vi.fn();

vi.mock("../server/pilotRepository.js", () => ({
  listPublishedTimetableDiscovery,
  getPublishedTimetableBySlug,
}));

vi.mock("../server/timetablePublicSettingsRepository.js", () => ({
  getTimetablePublicDisplaySettings,
}));

vi.mock("../src/domain/resolvedSchedule.js", () => ({
  resolveRecurringSessions,
}));

describe("public timetable API core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the discovery response without depending on Node response objects", async () => {
    listPublishedTimetableDiscovery.mockResolvedValue([
      {
        publicSlug: "hit-sbt-1-1-august-semester-2026",
        institutionName: "Harare Institute of Technology",
        institutionTimezone: "Africa/Harare",
        programmeName: "BTech Biotechnology",
        classGroupLabel: "Part 1.1",
        academicPeriodName: "August Semester 2026",
        academicPeriodStartsOn: "2026-08-01",
        academicPeriodEndsOn: "2026-12-15",
        lastUpdated: "2026-10-12T10:00:00.000Z",
      },
    ]);

    const { listPublicTimetableDiscoveryResponse } =
      await import("../server/publicTimetableCore.js");

    await expect(listPublicTimetableDiscoveryResponse()).resolves.toEqual({
      timetables: [
        {
          publicSlug: "hit-sbt-1-1-august-semester-2026",
          institutionName: "Harare Institute of Technology",
          timezone: "Africa/Harare",
          programmeName: "BTech Biotechnology",
          classGroupLabel: "Part 1.1",
          academicPeriodName: "August Semester 2026",
          startsOn: "2026-08-01",
          endsOn: "2026-12-15",
          lastUpdated: "2026-10-12T10:00:00.000Z",
        },
      ],
    });
  });

  it("returns raw sessions plus explicit effectiveSessions for a published timetable", async () => {
    const rawSession = {
      stableSessionKey: "source-wednesday",
      courseCode: "ISE4105",
      courseName: "Software Testing & Quality Assurance",
      weekday: 3,
      startTime: "12:15:00",
      endTime: "13:15:00",
      venue: "N109",
      lecturer: null,
      sessionType: "Lecture",
      notes: null,
    };
    const effectiveSession = {
      ...rawSession,
      stableSessionKey: "correction-tuesday",
      weekday: 2,
    };
    getPublishedTimetableBySlug.mockResolvedValue({
      timetableId: "timetable-1",
      publicSlug: "ise-part-4-1-august-semester-2026",
      sessions: [rawSession],
      corrections: [{ id: "remove-wednesday", action: "remove" }],
      exceptions: [],
      pauses: [],
    });
    getTimetablePublicDisplaySettings.mockResolvedValue({
      enabled: true,
    });
    resolveRecurringSessions.mockReturnValue([effectiveSession]);

    const { getPublicTimetableResponse } =
      await import("../server/publicTimetableCore.js");

    await expect(
      getPublicTimetableResponse("ise-part-4-1-august-semester-2026"),
    ).resolves.toMatchObject({
      timetable: {
        timetableId: "timetable-1",
        sessions: [rawSession],
        effectiveSessions: [effectiveSession],
        publicDisplay: { enabled: true },
      },
    });
    expect(resolveRecurringSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [rawSession],
      }),
    );
  });
});
