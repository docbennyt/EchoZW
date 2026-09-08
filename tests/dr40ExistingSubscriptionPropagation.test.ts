import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";

const repositoryMocks = vi.hoisted(() => ({
  createCalendarSubscriptionRecord: vi.fn(),
  getCalendarSubscriptionById: vi.fn(),
  getCalendarSubscriptionByTokenHash: vi.fn(),
  getPublishedTimetableById: vi.fn(),
}));

const revisionMocks = vi.hoisted(() => ({
  getCalendarRevision: vi.fn(),
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
    ...repositoryMocks,
  };
});

vi.mock("../server/calendarRevisionRepository", () => revisionMocks);
vi.mock("../server/analyticsRepository", () => analyticsMocks);

import { handlePilotCalendarRequest } from "../server/pilotCalendarApi";

const PUBLIC_ORIGIN = "https://calender.aido.co.zw";
const PUBLIC_SLUG = "hit-cs-1-1-august-2026";
const STABLE_ICS1102 = "stable-ics1102-tue-1400";
const STABLE_HIT1101 = "stable-hit1101-mon-0800";

function baseTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-cs1",
    publicSlug: PUBLIC_SLUG,
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "BTech Computer Science",
    classGroup: "1.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-09T08:00:00.000Z",
    versionNumber: 1,
    sessions: [
      {
        stableSessionKey: STABLE_ICS1102,
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        weekday: 2,
        startTime: "14:00:00",
        endTime: "16:00:00",
        venue: "N109",
        lecturer: "Ms Dube",
        sessionType: "Lecture",
        notes: null,
      },
      {
        stableSessionKey: STABLE_HIT1101,
        courseCode: "HIT1101",
        courseName: "Technopreneurship I",
        weekday: 1,
        startTime: "08:00:00",
        endTime: "10:00:00",
        venue: "Engineering Hall",
        lecturer: "TDC",
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
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
      if (chunk) {
        capture.body += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      }
      return response;
    },
  } as unknown as ServerResponse;
  return { response, capture };
}

async function request(input: {
  method?: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const { response, capture } = makeResponse();
  const handled = await handlePilotCalendarRequest(
    makeRequest({
      method: input.method ?? "GET",
      url: input.url,
      headers: input.headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    }),
    response,
    { PUBLIC_APP_URL: PUBLIC_ORIGIN },
    "production",
  );
  expect(handled).toBe(true);
  return capture;
}

async function createExistingSubscription() {
  const result = await request({
    method: "POST",
    url: "/api/calendar/subscriptions",
    headers: { "content-type": "application/json" },
    body: {
      timetableId: "tt-cs1",
      provider: "webcal_subscription",
      reminderPreset: "custom",
      customReminderOffsets: [30],
      timezone: "Africa/Harare",
      subscriberContact: {
        countryCode: "ZW",
        phone: "077 123 4567",
        consentUpdates: true,
        consentSource: "calendar_onboarding",
      },
    },
  });

  expect(result.statusCode).toBe(201);
  const payload = JSON.parse(result.body) as {
    feedUrl: string;
    subscriptionId: string;
    contact: { saved: boolean; countryCode?: string };
  };
  expect(payload.subscriptionId).toBe("sub-existing");
  expect(payload.contact).toEqual({ saved: true, countryCode: "ZW" });
  expect(payload.feedUrl).toMatch(
    /^https:\/\/calender\.aido\.co\.zw\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/,
  );
  return payload.feedUrl;
}

function pathFromUrl(value: string) {
  const parsed = new URL(value);
  return `${parsed.pathname}${parsed.search}`;
}

function uidValues(ics: string) {
  return [...ics.matchAll(/^UID:(.+)$/gm)].map((match) =>
    match[1].replace(/\r$/, ""),
  );
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}

const existingSubscription = {
  id: "sub-existing",
  timetable_id: "tt-cs1",
  calendar_name: "Class 1.1 · CalenderZW",
  reminder_offsets_minutes: [30],
  revoked_at: null,
};

let currentTimetable: PublicTimetable;
let currentRevision: { updatedAt: string; sequence: number };

describe("DR-40 existing calendar subscription propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTimetable = baseTimetable();
    currentRevision = {
      updatedAt: "2026-08-09T08:00:00.000Z",
      sequence: 1,
    };
    repositoryMocks.createCalendarSubscriptionRecord.mockResolvedValue({
      id: "sub-existing",
      timetable_id: "tt-cs1",
      calendar_name: "Class 1.1 · CalenderZW",
      subscriber_profile_id: "profile-existing",
    });
    repositoryMocks.getCalendarSubscriptionByTokenHash.mockImplementation(
      async () => existingSubscription,
    );
    repositoryMocks.getPublishedTimetableById.mockImplementation(
      async () => currentTimetable,
    );
    revisionMocks.getCalendarRevision.mockImplementation(
      async () => currentRevision,
    );
    analyticsMocks.recordCalendarFeedActivity.mockResolvedValue(undefined);
  });

  it("updates the exact onboarding-created feed URL after a CS.1 venue publication without UID churn or resubscription", async () => {
    const feedUrl = await createExistingSubscription();
    const feedPath = pathFromUrl(feedUrl);
    const before = await request({ url: feedPath });

    expect(before.statusCode).toBe(200);
    expect(before.body).toContain(`UID:${STABLE_ICS1102}@calender.aido.co.zw`);
    expect(before.body).toContain("LOCATION:N109");
    expect(before.body).toContain("SEQUENCE:1");
    expect(before.body).toContain("LAST-MODIFIED:20260809T080000Z");
    expect(before.body).toContain(
      `CalenderZW timetable: ${PUBLIC_ORIGIN}/t/${PUBLIC_SLUG}`,
    );
    expect(before.body).toContain("TRIGGER:-PT30M");

    currentTimetable = baseTimetable({
      versionNumber: 2,
      publishedAt: "2026-08-10T09:30:00.000Z",
      sessions: baseTimetable().sessions.map((session) =>
        session.stableSessionKey === STABLE_ICS1102
          ? { ...session, venue: "N205" }
          : session,
      ),
    });
    currentRevision = {
      updatedAt: "2026-08-10T09:30:00.000Z",
      sequence: 2,
    };

    const after = await request({
      url: feedPath,
      headers: { "if-none-match": before.headers.etag },
    });

    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(after.headers["last-modified"]).not.toBe(
      before.headers["last-modified"],
    );
    expect(after.body).toContain(`UID:${STABLE_ICS1102}@calender.aido.co.zw`);
    expect(after.body).toContain("LOCATION:N205");
    expect(after.body).not.toContain("LOCATION:N109");
    expect(after.body).toContain("SEQUENCE:2");
    expect(after.body).toContain("LAST-MODIFIED:20260810T093000Z");
    expect(after.body).toContain("TRIGGER:-PT30M");
    expect(after.body).toContain(
      `CalenderZW timetable: ${PUBLIC_ORIGIN}/t/${PUBLIC_SLUG}`,
    );

    const beforeUids = uidValues(before.body);
    const afterUids = uidValues(after.body);
    expect(afterUids).toEqual(beforeUids);
    expect(new Set(afterUids).size).toBe(afterUids.length);
    expect(count(after.body, `UID:${STABLE_ICS1102}@calender.aido.co.zw`)).toBe(
      1,
    );

    const unchanged = await request({
      url: feedPath,
      headers: { "if-none-match": after.headers.etag },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
  });

  it("gives an authorized Class Rep modification the same stable UID propagation semantics as an official republish", async () => {
    const feedUrl = await createExistingSubscription();
    const feedPath = pathFromUrl(feedUrl);
    const before = await request({ url: feedPath });

    currentTimetable = baseTimetable({
      corrections: [
        {
          id: "corr-ics1102-venue",
          stableSessionKey: STABLE_ICS1102,
          action: "modify",
          sourceMayReplace: true,
          pinned: false,
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          weekday: 2,
          startTime: "14:00:00",
          endTime: "16:00:00",
          venue: "N205",
          lecturer: "Ms Dube",
          sessionType: "Lecture",
          notes: null,
          reason: "Venue changed",
          provenance: "Class representative",
          creatorRole: "class_rep",
          active: true,
          createdAt: "2026-09-08T09:00:00.000Z",
        },
      ],
    });
    currentRevision = {
      updatedAt: "2026-09-08T09:00:00.000Z",
      sequence: 2,
    };

    const after = await request({ url: feedPath });
    expect(after.body).toContain(`UID:${STABLE_ICS1102}@calender.aido.co.zw`);
    expect(after.body).toContain("LOCATION:N205");
    expect(after.body).toContain("SEQUENCE:2");
    expect(uidValues(after.body)).toEqual(uidValues(before.body));
    expect(count(after.body, `UID:${STABLE_ICS1102}@calender.aido.co.zw`)).toBe(
      1,
    );
  });

  it("represents adds, recurring removals and date cancellation using the repository's existing ICS semantics", async () => {
    const feedUrl = await createExistingSubscription();
    const feedPath = pathFromUrl(feedUrl);

    currentTimetable = baseTimetable({
      corrections: [
        {
          id: "corr-remove-hit1101",
          stableSessionKey: STABLE_HIT1101,
          action: "remove",
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
          reason: "Class removed",
          provenance: "Authorized timetable correction",
          creatorRole: "admin",
          active: true,
          createdAt: "2026-09-08T10:00:00.000Z",
        },
        {
          id: "corr-add-ics1200",
          stableSessionKey: null,
          action: "add",
          sourceMayReplace: true,
          pinned: false,
          courseCode: "ICS1200",
          courseName: "Systems Lab",
          weekday: 3,
          startTime: "11:00:00",
          endTime: "13:00:00",
          venue: "N210",
          lecturer: "Dr Moyo",
          sessionType: "Lab",
          notes: null,
          reason: "Added class",
          provenance: "Authorized timetable correction",
          creatorRole: "admin",
          active: true,
          createdAt: "2026-09-08T10:01:00.000Z",
        },
      ],
      exceptions: [
        {
          id: "exc-cancel-ics1102",
          stableSessionKey: STABLE_ICS1102,
          exceptionType: "cancelled",
          exceptionDate: "2026-09-15",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: null,
          courseName: null,
          startTime: null,
          endTime: null,
          venue: null,
          lecturer: null,
          sessionType: null,
          notes: null,
          reason: "No lecture",
          provenance: "Department notice",
          creatorRole: "admin",
          active: true,
          createdAt: "2026-09-08T10:02:00.000Z",
        },
      ],
    });
    currentRevision = {
      updatedAt: "2026-09-08T10:02:00.000Z",
      sequence: 5,
    };

    const result = await request({ url: feedPath });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain(
      `UID:${STABLE_HIT1101}@calender.aido.co.zw`,
    );
    expect(count(result.body, "UID:correction-corr-add-ics1200@calender.aido.co.zw")).toBe(
      1,
    );
    expect(result.body).toContain(
      "EXDATE;TZID=Africa/Harare:20260915T140000",
    );
    const uids = uidValues(result.body);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("keeps feed telemetry and private-token handling observational rather than behavior-changing", async () => {
    const feedUrl = await createExistingSubscription();
    const feedPath = pathFromUrl(feedUrl);
    const privateToken = feedPath.match(/\/calendar\/feed\/([^/]+)\.ics$/)?.[1];
    expect(privateToken).toBeTruthy();

    analyticsMocks.recordCalendarFeedActivity.mockRejectedValueOnce(
      new Error("telemetry unavailable"),
    );
    const result = await request({
      url: feedPath,
      headers: { "user-agent": "CalendarClient/1.0" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("BEGIN:VCALENDAR\r\n");
    expect(result.body).toContain(
      `CalenderZW timetable: ${PUBLIC_ORIGIN}/t/${PUBLIC_SLUG}`,
    );
    expect(result.body).not.toContain(privateToken as string);
    expect(result.body).not.toContain(feedUrl);
    expect(analyticsMocks.recordCalendarFeedActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        statusCode: 200,
      }),
      expect.any(Object),
    );
  });
});
