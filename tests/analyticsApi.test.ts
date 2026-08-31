import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  handleAnalyticsRequest,
  parseAnalyticsPayload,
  resetAnalyticsRateLimitsForTests,
} from "../server/analyticsApi";

const anonymousId = "4b3f08c9-78b7-4af5-9a2b-dc859fabcf63";
const sessionId = "a9f5cf94-9509-4120-b07a-69a1b9ba7811";

function payload(properties: Record<string, unknown> = {}) {
  return {
    productKey: "calenderzw",
    anonymousId,
    sessionId,
    events: [
      {
        name: "timetable_viewed",
        properties: {
          publicSlug: "hit-ics-1-1-august-semester-2026",
          ...properties,
        },
        clientTimestamp: new Date().toISOString(),
      },
    ],
  };
}

function createRequest(body: string) {
  return Object.assign(Readable.from([body]), {
    method: "POST",
    url: "/api/analytics/events",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function createResponse() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    headers?: Record<string, string>;
    statusCode?: number;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return {
    res,
    body: () => JSON.parse(chunks.join("")),
  };
}

describe("analytics API", () => {
  it("rejects unsupported or sensitive properties", () => {
    expect(() => parseAnalyticsPayload(payload({ token: "private-feed-token" }))).toThrow(
      "unsupported properties",
    );
  });

  it("accepts valid anonymous events even when persistence is unavailable", async () => {
    resetAnalyticsRateLimitsForTests();
    const persistEvents = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const { res, body } = createResponse();

    await handleAnalyticsRequest(
      createRequest(JSON.stringify(payload({ provider: "webcal_subscription" }))),
      res,
      { NODE_ENV: "production" },
      { persistEvents },
    );

    expect(res.statusCode).toBe(202);
    expect(body()).toEqual({ accepted: 1, persisted: false });
    expect(res.headers?.["Set-Cookie"]).toContain(`calenderzw_anon_session=${anonymousId}`);
    expect(res.headers?.["Set-Cookie"]).toContain("Secure");
    expect(persistEvents).toHaveBeenCalledTimes(1);
    expect(persistEvents.mock.calls[0]?.[0]?.[0]).toMatchObject({
      eventName: "timetable_viewed",
      anonymousId,
      sessionId,
      publicSlug: "hit-ics-1-1-august-semester-2026",
      provider: "webcal_subscription",
      client: {
        deviceKind: "mobile",
        browserFamily: "chrome",
        osFamily: "android",
      },
    });
  });
});
