import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePublishedTimetableIcs } from "../server/publishedCalendar";
import type {
  PublicTimetable,
  PublicTimetableSession,
  TimetableCorrectionDirective,
} from "../src/api/pilotTypes";
import { fetchPublicTimetable } from "../src/api/publicTimetable";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection";
import { resolveRecurringSessions } from "../src/domain/resolvedSchedule";

const pilotRepositoryMocks = vi.hoisted(() => ({
  createCalendarSubscriptionRecord: vi.fn(),
  getCalendarSubscriptionById: vi.fn(),
  getCalendarSubscriptionByTokenHash: vi.fn(),
  getPublishedTimetableById: vi.fn(),
  getPublishedTimetableBySlug: vi.fn(),
  listPublishedTimetableDiscovery: vi.fn(),
}));

const revisionMocks = vi.hoisted(() => ({
  getCalendarRevision: vi.fn(),
}));

const publicSettingsMocks = vi.hoisted(() => ({
  getTimetablePublicDisplaySettings: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({
  recordCalendarFeedActivity: vi.fn(),
}));

vi.mock("../server/pilotRepository", () => {
  class PilotApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }

  return {
    PilotApiError,
    ...pilotRepositoryMocks,
  };
});

vi.mock("../server/calendarRevisionRepository", () => revisionMocks);
vi.mock(
  "../server/timetablePublicSettingsRepository",
  () => publicSettingsMocks,
);
vi.mock("../server/analyticsRepository", () => analyticsMocks);

import { handlePilotCalendarRequest } from "../server/pilotCalendarApi";
import { handlePublicTimetableRequest } from "../server/publicTimetableApi";

const PUBLIC_ORIGIN = "https://calender.aido.co.zw";
const TIMETABLE_ID = "08a30b9b-ed8f-4aea-91de-09d4e1124f9a";
const PUBLIC_SLUG = "ise-part-4-1-august-semester-2026";
const WEDNESDAY_ISE4105_KEY = "source_778238ed6e5a0718deaa192c";
const THURSDAY_ISE4105_KEY = "source_837456f0559a130ed8e76703";
const REMOVE_DIRECTIVE_ID = "5c11f73f-536d-45db-a67e-d953796cc97d";
const ADD_DIRECTIVE_ID = "7e075572-f56f-436b-94c8-b81c4ca19a63";

function session(
  stableSessionKey: string,
  courseCode: string,
  courseName: string,
  weekday: number,
  startTime: string,
  endTime: string,
  venue: string,
): PublicTimetableSession {
  return {
    stableSessionKey,
    courseCode,
    courseName,
    weekday,
    startTime,
    endTime,
    venue,
    lecturer: null,
    sessionType: "Lecture",
    notes: null,
  };
}

function activeRemove(): TimetableCorrectionDirective {
  return {
    id: REMOVE_DIRECTIVE_ID,
    stableSessionKey: WEDNESDAY_ISE4105_KEY,
    action: "remove",
    sourceMayReplace: true,
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
    reason: "Class Rep confirmed Wednesday occurrence should be suppressed.",
    provenance: "Class Rep audited correction",
    creatorRole: "class_rep",
    active: true,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
  };
}

function activeAdd(): TimetableCorrectionDirective {
  return {
    id: ADD_DIRECTIVE_ID,
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
    lecturer: null,
    sessionType: "Lecture",
    notes: null,
    reason: "Class Rep confirmed corrected Tuesday occurrence.",
    provenance: "Class Rep audited correction",
    creatorRole: "class_rep",
    active: true,
    createdAt: "2026-10-01T08:01:00.000Z",
    updatedAt: "2026-10-01T08:01:00.000Z",
  };
}

function inactiveHistoricalAdd(): TimetableCorrectionDirective {
  return {
    ...activeAdd(),
    id: "inactive-old-ise4105-add",
    weekday: 1,
    active: false,
    supersededAt: "2026-10-01T08:01:00.000Z",
    createdAt: "2026-09-30T08:01:00.000Z",
    updatedAt: "2026-09-30T08:01:00.000Z",
  };
}

function se41Timetable(): PublicTimetable {
  return {
    timetableId: TIMETABLE_ID,
    publicSlug: PUBLIC_SLUG,
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "Btech Software Engineering",
    classGroup: "Part 4.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-08-16",
    publishedAt: "2026-09-01T08:00:00.000Z",
    versionNumber: 1,
    sessions: [
      session(
        WEDNESDAY_ISE4105_KEY,
        "ISE4105",
        "Software Testing & Quality Assurance",
        3,
        "12:15:00",
        "13:15:00",
        "N109",
      ),
      session(
        THURSDAY_ISE4105_KEY,
        "ISE4105",
        "Software Testing & Quality Assurance",
        4,
        "08:00:00",
        "10:00:00",
        "S107",
      ),
      session(
        "source_se4101_mon",
        "ISE4101",
        "Research Methods",
        1,
        "08:00:00",
        "10:00:00",
        "N101",
      ),
      session(
        "source_se4102_mon",
        "ISE4102",
        "Distributed Systems",
        1,
        "10:15:00",
        "12:15:00",
        "N102",
      ),
      session(
        "source_se4103_mon",
        "ISE4103",
        "Software Project Management",
        1,
        "14:00:00",
        "16:00:00",
        "N103",
      ),
      session(
        "source_se4104_tue",
        "ISE4104",
        "Enterprise Architecture",
        2,
        "08:00:00",
        "10:00:00",
        "N104",
      ),
      session(
        "source_se4106_tue",
        "ISE4106",
        "Advanced Databases",
        2,
        "10:15:00",
        "12:15:00",
        "N105",
      ),
      session(
        "source_se4107_wed",
        "ISE4107",
        "Information Security",
        3,
        "08:00:00",
        "10:00:00",
        "N106",
      ),
      session(
        "source_se4108_wed",
        "ISE4108",
        "Software Architecture",
        3,
        "10:15:00",
        "12:15:00",
        "N107",
      ),
      session(
        "source_se4109_thu",
        "ISE4109",
        "Mobile Computing",
        4,
        "10:15:00",
        "12:15:00",
        "N108",
      ),
      session(
        "source_se4110_thu",
        "ISE4110",
        "Professional Practice",
        4,
        "14:00:00",
        "16:00:00",
        "N110",
      ),
      session(
        "source_se4111_fri",
        "ISE4111",
        "Cloud Computing",
        5,
        "08:00:00",
        "10:00:00",
        "N111",
      ),
      session(
        "source_se4112_fri",
        "ISE4112",
        "Human Computer Interaction",
        5,
        "10:15:00",
        "12:15:00",
        "N112",
      ),
      session(
        "source_se4113_fri",
        "ISE4113",
        "Capstone Studio",
        5,
        "12:30:00",
        "14:30:00",
        "N113",
      ),
      session(
        "source_se4114_fri",
        "ISE4114",
        "Entrepreneurship",
        5,
        "14:45:00",
        "16:45:00",
        "N114",
      ),
    ],
    corrections: [inactiveHistoricalAdd(), activeRemove(), activeAdd()],
  };
}

type ResponseCapture = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function makeRequest(input: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  const request = Readable.from(input.body ? [input.body] : []) as Readable &
    Partial<IncomingMessage>;
  request.method = input.method;
  request.url = input.url;
  request.headers = input.headers ?? {};
  return request as IncomingMessage;
}

function makeResponse() {
  const capture: ResponseCapture = { statusCode: 0, headers: {}, body: "" };
  const response = {
    writeHead(statusCode: number, headers?: Record<string, string>) {
      capture.statusCode = statusCode;
      capture.headers = Object.fromEntries(
        Object.entries(headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          String(value),
        ]),
      );
      return response;
    },
    end(chunk?: string | Buffer) {
      if (chunk)
        capture.body += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      return response;
    },
  } as unknown as ServerResponse;
  return { response, capture };
}

async function runPublicTimetableApi(timetable: PublicTimetable) {
  pilotRepositoryMocks.getPublishedTimetableBySlug.mockResolvedValue(timetable);
  publicSettingsMocks.getTimetablePublicDisplaySettings.mockResolvedValue({
    showVisualPreview: true,
    showChangeAlerts: true,
  });
  const { response, capture } = makeResponse();
  const handled = await handlePublicTimetableRequest(
    makeRequest({
      method: "GET",
      url: `/api/public/timetables/${PUBLIC_SLUG}`,
    }),
    response,
  );
  expect(handled).toBe(true);
  return capture;
}

function ise4105Times(sessions: PublicTimetableSession[]) {
  return sessions
    .filter((item) => item.courseCode === "ISE4105")
    .map(
      (item) =>
        `${item.weekday}:${item.startTime}-${item.endTime}:${item.venue}`,
    )
    .sort();
}

function unfoldIcs(value: string) {
  return value.replace(/\r\n[ \t]/g, "");
}

describe("DR-168 SE 4.1 effective schedule contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the production-shaped Class Rep corrections without mutating source evidence", () => {
    const raw = se41Timetable();
    const sourceSnapshot = structuredClone(raw.sessions);

    const resolved = resolveRecurringSessions(raw);

    expect(raw.sessions).toEqual(sourceSnapshot);
    expect(raw.sessions).toHaveLength(15);
    expect(raw.sessions).toContainEqual(
      expect.objectContaining({
        stableSessionKey: WEDNESDAY_ISE4105_KEY,
        courseCode: "ISE4105",
        weekday: 3,
        startTime: "12:15:00",
        venue: "N109",
      }),
    );
    expect(raw.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: REMOVE_DIRECTIVE_ID,
          action: "remove",
          stableSessionKey: WEDNESDAY_ISE4105_KEY,
          active: true,
        }),
        expect.objectContaining({
          id: ADD_DIRECTIVE_ID,
          action: "add",
          active: true,
          sourceMayReplace: false,
          weekday: 2,
          startTime: "12:15:00",
        }),
        expect.objectContaining({
          id: "inactive-old-ise4105-add",
          active: false,
        }),
      ]),
    );
    expect(resolved).toHaveLength(15);
    expect(ise4105Times(resolved)).toEqual([
      "2:12:15:00-13:15:00:N109",
      "4:08:00:00-10:00:00:S107",
    ]);
    expect(
      resolved.some(
        (item) =>
          item.stableSessionKey === WEDNESDAY_ISE4105_KEY ||
          (item.courseCode === "ISE4105" &&
            item.weekday === 3 &&
            item.startTime === "12:15:00"),
      ),
    ).toBe(false);
    expect(
      resolved.filter(
        (item) => item.stableSessionKey === `correction-${ADD_DIRECTIVE_ID}`,
      ),
    ).toHaveLength(1);
  });

  it("returns raw sessions plus an additive effectiveSessions projection from the public API", async () => {
    const raw = se41Timetable();
    const sourceSnapshot = structuredClone(raw.sessions);

    const result = await runPublicTimetableApi(raw);

    expect(result.statusCode).toBe(200);
    const payload = JSON.parse(result.body) as { timetable: PublicTimetable };
    expect(payload.timetable.sessions).toEqual(sourceSnapshot);
    expect(payload.timetable.sessions).toContainEqual(
      expect.objectContaining({
        stableSessionKey: WEDNESDAY_ISE4105_KEY,
        weekday: 3,
        startTime: "12:15:00",
      }),
    );
    expect(payload.timetable.effectiveSessions).toHaveLength(15);
    expect(ise4105Times(payload.timetable.effectiveSessions ?? [])).toEqual([
      "2:12:15:00-13:15:00:N109",
      "4:08:00:00-10:00:00:S107",
    ]);
    expect(payload.timetable.publicDisplay).toEqual({
      showVisualPreview: true,
      showChangeAlerts: true,
    });
  });

  it("preserves raw sessions while exposing server-provided effectiveSessions for React consumers", async () => {
    const raw = se41Timetable();
    const effectiveSessions = resolveRecurringSessions(raw);
    const rawSessions = structuredClone(raw.sessions);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          timetable: { ...raw, effectiveSessions },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const timetable = await fetchPublicTimetable(PUBLIC_SLUG);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/timetables/${PUBLIC_SLUG}`,
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    expect(timetable.sessions).toEqual(rawSessions);
    expect(timetable.sessions).toContainEqual(
      expect.objectContaining({
        stableSessionKey: WEDNESDAY_ISE4105_KEY,
        weekday: 3,
        startTime: "12:15:00",
      }),
    );
    expect(timetable.effectiveSessions).toEqual(effectiveSessions);
    expect(timetable.effectiveSessions).toHaveLength(15);
    expect(ise4105Times(timetable.effectiveSessions ?? [])).toEqual([
      "2:12:15:00-13:15:00:N109",
      "4:08:00:00-10:00:00:S107",
    ]);
  });

  it("projects the same effective truth to canonical calendar events and ICS without duplicate ISE4105 entries", () => {
    const raw = se41Timetable();
    const revisionAware = {
      ...raw,
      publishedAt: "2026-10-01T08:01:00.000Z",
      versionNumber: 4,
    };

    const projection = projectPublishedTimetable({
      timetable: revisionAware,
      publicOrigin: PUBLIC_ORIGIN,
    });
    const ics = unfoldIcs(
      generatePublishedTimetableIcs({
        timetable: revisionAware,
        reminderOffsetsMinutes: [30],
        publicOrigin: PUBLIC_ORIGIN,
      }),
    );

    expect(projection.events).toHaveLength(15);
    expect(
      projection.events.filter((event) => event.courseCode === "ISE4105"),
    ).toEqual([
      expect.objectContaining({
        stableSessionKey: `correction-${ADD_DIRECTIVE_ID}`,
        weekday: 2,
        startTime: "12:15:00",
        endTime: "13:15:00",
        venue: "N109",
        sequence: 4,
        lastModifiedUtc: "20261001T080100Z",
      }),
      expect.objectContaining({
        stableSessionKey: THURSDAY_ISE4105_KEY,
        weekday: 4,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "S107",
        sequence: 4,
      }),
    ]);
    expect(projection.events).not.toContainEqual(
      expect.objectContaining({
        stableSessionKey: WEDNESDAY_ISE4105_KEY,
      }),
    );
    expect(ics).toContain(
      `UID:correction-${ADD_DIRECTIVE_ID}@calender.aido.co.zw`,
    );
    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260811T121500");
    expect(ics).toContain(`UID:${THURSDAY_ISE4105_KEY}@calender.aido.co.zw`);
    expect(ics).toContain("DTSTART;TZID=Africa/Harare:20260813T080000");
    expect(ics).toContain("SEQUENCE:4");
    expect(ics).toContain("LAST-MODIFIED:20261001T080100Z");
    expect(ics).not.toContain(
      `UID:${WEDNESDAY_ISE4105_KEY}@calender.aido.co.zw`,
    );
    expect(ics).not.toContain("DTSTART;TZID=Africa/Harare:20260812T121500");
    expect(
      ics.match(new RegExp(`UID:correction-${ADD_DIRECTIVE_ID}@`, "g")),
    ).toHaveLength(1);
  });

  it("changes subscription ETag, LAST-MODIFIED, and SEQUENCE when directives revise the same feed URL", async () => {
    const subscription = {
      id: "subscription-se41",
      timetable_id: TIMETABLE_ID,
      calendar_name: "Part 4.1 · CalenderZW",
      reminder_offsets_minutes: [30],
      revoked_at: null,
    };
    const beforeTimetable = {
      ...se41Timetable(),
      corrections: [],
    };
    const afterTimetable = se41Timetable();
    pilotRepositoryMocks.getCalendarSubscriptionByTokenHash.mockResolvedValue(
      subscription,
    );
    analyticsMocks.recordCalendarFeedActivity.mockResolvedValue(undefined);
    pilotRepositoryMocks.getPublishedTimetableById.mockResolvedValueOnce(
      beforeTimetable,
    );
    revisionMocks.getCalendarRevision.mockResolvedValueOnce({
      updatedAt: "2026-09-01T08:00:00.000Z",
      sequence: 1,
    });

    const first = await requestCalendarFeed();

    pilotRepositoryMocks.getPublishedTimetableById.mockResolvedValueOnce(
      afterTimetable,
    );
    revisionMocks.getCalendarRevision.mockResolvedValueOnce({
      updatedAt: "2026-10-01T08:01:00.000Z",
      sequence: 4,
    });
    const after = await requestCalendarFeed({
      "if-none-match": first.headers.etag,
    });

    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(first.headers.etag);
    expect(after.headers["last-modified"]).not.toBe(
      first.headers["last-modified"],
    );
    expect(after.body).toContain("SEQUENCE:4");
    expect(after.body).toContain("LAST-MODIFIED:20261001T080100Z");
    expect(after.body).toContain(
      `UID:correction-${ADD_DIRECTIVE_ID}@calender.aido.co.zw`,
    );
    expect(after.body).toContain(
      `UID:${THURSDAY_ISE4105_KEY}@calender.aido.co.zw`,
    );
    expect(after.body).not.toContain(
      `UID:${WEDNESDAY_ISE4105_KEY}@calender.aido.co.zw`,
    );

    pilotRepositoryMocks.getPublishedTimetableById.mockResolvedValueOnce(
      afterTimetable,
    );
    revisionMocks.getCalendarRevision.mockResolvedValueOnce({
      updatedAt: "2026-10-01T08:01:00.000Z",
      sequence: 4,
    });
    const current = await requestCalendarFeed({
      "if-none-match": after.headers.etag,
    });
    expect(current.statusCode).toBe(304);
    expect(current.body).toBe("");
  });
});

async function requestCalendarFeed(headers?: Record<string, string>) {
  const { response, capture } = makeResponse();
  const handled = await handlePilotCalendarRequest(
    makeRequest({
      method: "GET",
      url: "/calendar/feed/private-se41-token.ics",
      headers,
    }),
    response,
    { PUBLIC_APP_URL: PUBLIC_ORIGIN },
    "production",
  );
  expect(handled).toBe(true);
  return capture;
}
