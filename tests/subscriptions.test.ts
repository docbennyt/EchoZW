import { describe, expect, it } from "vitest";
import { demoTimetable } from "../src/domain/timetableData";
import {
  buildSubscriptionResponse,
  createSubscriptionRecord,
  getReminderOffsets,
  toWebcalUrl,
} from "../src/domain/subscriptions";
import { generateFeedToken, sha256Base64Url } from "../src/domain/token";

describe("calendar subscriptions", () => {
  it("maps reminder presets to exact offsets", () => {
    expect(getReminderOffsets("prepared", [])).toEqual([1440, 30]);
    expect(getReminderOffsets("commuter", [])).toEqual([60, 15]);
    expect(getReminderOffsets("custom", [30, 5, 30])).toEqual([30, 5]);
  });

  it("generates unguessable-looking feed tokens and stores only hashes", async () => {
    const token = generateFeedToken();
    const hash = await sha256Base64Url(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hash).not.toBe(token);
  });

  it("creates webcal URLs only from HTTPS feed URLs", () => {
    expect(
      toWebcalUrl("https://calendar.example.com/calendar/feed/a.ics"),
    ).toBe("webcal://calendar.example.com/calendar/feed/a.ics");
    expect(() =>
      toWebcalUrl("http://localhost:5173/calendar/feed/a.ics"),
    ).toThrow("HTTPS");
  });

  it("does not expose Apple webcal for localhost development feeds", () => {
    const subscription = createSubscriptionRecord({
      timetable: demoTimetable,
      provider: "apple_subscription",
      reminderPreset: "prepared",
      reminderOffsetsMinutes: [1440, 30],
      anonymousSessionId: crypto.randomUUID(),
      rawToken: "dev-token",
      tokenHash: "hash",
    });
    const response = buildSubscriptionResponse({
      subscription,
      publicOrigin: "http://localhost:5173",
      timetable: demoTimetable,
      externallyFetchable: false,
    });

    expect(response.feedUrl).toBe(
      "http://localhost:5173/calendar/feed/dev-token.ics",
    );
    expect(response.appleSubscribeUrl).toBeUndefined();
    expect(response.warnings[0]).toContain("not externally fetchable");
  });
});
