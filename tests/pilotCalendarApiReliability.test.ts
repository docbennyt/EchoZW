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

import { handlePilotCalendarRequest } from "../server/pilotCalendarApi";

function makeTimetable(
  overrides: Partial<PublicTimetable> = {},
): PublicTimetable {
  return {
    timetableId: "tt-1",
    publicSlug: "hit-cs-1-1-august-2026",
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
        stableSessionKey: "stable-hit1101",
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
  const capture: ResponseCapture = {
    statusCode: 0,
    headers: {},
    body: "",
  };
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
      if (chunk) capture.body += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      return response;
    },
  } as unknown as ServerResponse;
  return { response, capture };
}

const subscription = {
  id: "sub-1",
  timetable_id: "tt-1",
  calendar_name: "Class 1.1 · CalenderZW",
  reminder_offsets_minutes: [30],
  revoked_at: null,
};

async function runFeed(input: {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
}) {
  const { response, capture } = makeResponse();
  const handled = await handlePilotCalendarRequest(
    makeRequest({
      method: input.method ?? "GET",
      url: "/calendar/feed/private-test-token.ics",
      headers: input.headers,
    }),
    response,
    { PUBLIC_APP_URL: "https://calender.aido.co.zw" },
    "production",
  );
  expect(handled).toBe(true);
  return capture;
}

describe("private published calendar feed reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.getCalendarSubscriptionByTokenHash.mockResolvedValue(
      subscription,
    );
    repositoryMocks.getPublishedTimetableById.mockResolvedValue(makeTimetable());
    repositoryMocks.createCalendarSubscriptionRecord.mockResolvedValue({
      id: "sub-created",
      calendar_name: "Class 1.1 · CalenderZW",
    });
  });

  it("serves an unauthenticated GET as text/calendar with private revalidation headers", async () => {
    const result = await runFeed({});

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(result.headers["cache-control"]).toBe(
      "private, no-cache, max-age=0, must-revalidate",
    );
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(result.headers.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(result.headers["last-modified"]).toBeTruthy();
    expect(result.body).toContain("BEGIN:VCALENDAR\r\n");
    expect(result.body).toContain(
      "DTSTART;TZID=Africa/Harare:20260810T080000",
    );
    expect(result.body).not.toContain("private-test-token");
  });

  it("supports HEAD with equivalent metadata and no response body", async () => {
    const get = await runFeed({});
    const head = await runFeed({ method: "HEAD" });

    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers.etag).toBe(get.headers.etag);
    expect(head.headers["last-modified"]).toBe(get.headers["last-modified"]);
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0);
  });

  it("returns 304 for current ETag and If-Modified-Since validators", async () => {
    const first = await runFeed({});
    const etagResult = await runFeed({
      headers: { "if-none-match": first.headers.etag },
    });
    const modifiedSinceResult = await runFeed({
      headers: { "if-modified-since": first.headers["last-modified"] },
    });

    expect(etagResult.statusCode).toBe(304);
    expect(etagResult.body).toBe("");
    expect(etagResult.headers["content-length"]).toBeUndefined();
    expect(modifiedSinceResult.statusCode).toBe(304);
    expect(modifiedSinceResult.body).toBe("");
  });

  it("changes ETag and feed content on a newer publication", async () => {
    const first = await runFeed({});

    repositoryMocks.getPublishedTimetableById.mockResolvedValue(
      makeTimetable({
        versionNumber: 2,
        publishedAt: "2026-08-10T08:00:00.000Z",
        sessions: [
          {
            ...makeTimetable().sessions[0],
            venue: "N205",
          },
        ],
      }),
    );
    const republished = await runFeed({
      headers: { "if-none-match": first.headers.etag },
    });

    expect(republished.statusCode).toBe(200);
    expect(republished.headers.etag).not.toBe(first.headers.etag);
    expect(republished.body).toContain("UID:stable-hit1101@calender.aido.co.zw");
    expect(republished.body).toContain("LOCATION:N205");
    expect(republished.body).toContain("SEQUENCE:2");
    expect(first.body).toContain("UID:stable-hit1101@calender.aido.co.zw");
    expect(first.body).toContain("LOCATION:Engineering Hall");
    expect(first.body).toContain("SEQUENCE:1");
  });

  it("uses the serialized representation as the ETag source, including reminder personalization", async () => {
    const first = await runFeed({});
    const unchanged = await runFeed({});

    expect(unchanged.headers.etag).toBe(first.headers.etag);
    expect(unchanged.body).toBe(first.body);

    repositoryMocks.getCalendarSubscriptionByTokenHash.mockResolvedValue({
      ...subscription,
      reminder_offsets_minutes: [60, 15],
    });
    const personalized = await runFeed({});

    expect(personalized.statusCode).toBe(200);
    expect(personalized.headers.etag).not.toBe(first.headers.etag);
    expect(personalized.body).toContain("TRIGGER:-PT60M");
    expect(personalized.body).toContain("TRIGGER:-PT15M");
    expect(personalized.body).not.toContain("TRIGGER:-PT30M");
  });

  it("returns a safe 404 for an invalid feed token without echoing it", async () => {
    repositoryMocks.getCalendarSubscriptionByTokenHash.mockResolvedValue(null);
    const result = await runFeed({});

    expect(result.statusCode).toBe(404);
    expect(result.body).toContain("Calendar feed not found.");
    expect(result.body).not.toContain("private-test-token");
    expect(result.body).not.toContain("stack");
  });

  it("returns canonical HTTPS feed URL and only derives webcal as Apple convenience deep link", async () => {
    const body = JSON.stringify({
      timetableId: "tt-1",
      provider: "apple_subscription",
      reminderPreset: "on_time",
      customReminderOffsets: [],
      timezone: "Africa/Harare",
    });
    const { response, capture } = makeResponse();
    const handled = await handlePilotCalendarRequest(
      makeRequest({
        method: "POST",
        url: "/api/calendar/subscriptions",
        headers: { "content-type": "application/json" },
        body,
      }),
      response,
      { PUBLIC_APP_URL: "https://calender.aido.co.zw" },
      "production",
    );

    expect(handled).toBe(true);
    expect(capture.statusCode).toBe(201);
    expect(capture.headers["cache-control"]).toBe("no-store");
    const payload = JSON.parse(capture.body) as {
      feedUrl: string;
      appleDeepLinkUrl: string;
      appleSubscribeUrl: string;
      warnings: string[];
    };
    expect(payload.feedUrl).toMatch(
      /^https:\/\/calender\.aido\.co\.zw\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/,
    );
    expect(payload.appleDeepLinkUrl).toMatch(
      /^webcal:\/\/calender\.aido\.co\.zw\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/,
    );
    expect(payload.appleSubscribeUrl).toBe(payload.appleDeepLinkUrl);
    expect(payload.appleDeepLinkUrl).not.toContain("webcal://https://");
    expect(payload.warnings).toEqual([]);
  });
});
