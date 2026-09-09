import { describe, expect, it } from "vitest";
import {
  buildPushPayload,
  classifyWebPushFailure,
  parseRetryAfterSeconds,
} from "../server/pushNotificationService";
import type { ClaimedPushOutbox } from "../server/pushNotificationRepository";

const outbox: ClaimedPushOutbox = {
  id: "0f1e2d3c-4b5a-6789-8abc-def012345678",
  timetableId: "a1111111-1111-4111-8111-111111111111",
  publicSlug: "hit-ics-1-1-august-semester-2026",
  sourceKind: "correction",
  sourceId: "b2222222-2222-4222-8222-222222222222",
  changeKind: "venue_changed",
  changeCount: 1,
  payload: {
    courseCode: "ICS 112",
    venue: "Lab 2",
    endpoint: "must-never-leak",
  },
  attemptCount: 1,
};

describe("DR-46 web push delivery policy", () => {
  it("expires only provider-confirmed gone endpoints", () => {
    expect(classifyWebPushFailure({ statusCode: 404 })).toEqual({
      result: "terminal",
      errorCode: "HTTP_404",
      retryAfterSeconds: null,
    });
    expect(classifyWebPushFailure({ statusCode: 410 }).result).toBe("terminal");
    expect(classifyWebPushFailure({ statusCode: 401 }).result).toBe("retry");
    expect(classifyWebPushFailure({ statusCode: 403 }).result).toBe("retry");
    expect(classifyWebPushFailure({ statusCode: 503 }).result).toBe("retry");
  });

  it("honors Retry-After without allowing unbounded delays", () => {
    expect(
      classifyWebPushFailure({
        statusCode: 429,
        headers: { "retry-after": "90" },
      }),
    ).toMatchObject({ result: "retry", retryAfterSeconds: 90 });
    expect(parseRetryAfterSeconds("7200")).toBe(3600);
  });

  it("builds a privacy-minimal notification payload", () => {
    const payload = JSON.parse(buildPushPayload(outbox));
    expect(payload).toMatchObject({
      title: "CalenderZW timetable update",
      body: "ICS 112: A venue changed.",
      url: "/t/hit-ics-1-1-august-semester-2026",
    });
    expect(JSON.stringify(payload)).not.toContain("must-never-leak");
    expect(JSON.stringify(payload)).not.toContain("Lab 2");
    expect(JSON.stringify(payload)).not.toContain(outbox.sourceId);
  });
});
