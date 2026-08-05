import { describe, expect, it } from "vitest";
import {
  mapToGoogleEvents,
  getGoogleSyncPlan,
} from "../src/domain/googleCalendar";
import { demoTimetable } from "../src/domain/timetableData";
import { createSubscriptionRecord } from "../src/domain/subscriptions";

describe("Google Calendar mapping", () => {
  it("maps selected reminders to popup overrides", () => {
    const subscription = createSubscriptionRecord({
      timetable: demoTimetable,
      provider: "google_api",
      reminderPreset: "commuter",
      reminderOffsetsMinutes: [60, 15],
      anonymousSessionId: crypto.randomUUID(),
    });

    const events = mapToGoogleEvents(demoTimetable, subscription);

    expect(events[0].reminders.useDefault).toBe(false);
    expect(events[0].start.timeZone).toBe("Africa/Harare");
    expect(events[0].end.dateTime).toContain("2026-08-10T10:00:00");
    expect(events[0].reminders.overrides).toEqual([
      { method: "popup", minutes: 60 },
      { method: "popup", minutes: 15 },
    ]);
    expect(events[0].extendedProperties.private.internalEventId).toBe(
      demoTimetable.events[0].id,
    );
  });

  it("plans idempotent creates, updates, and cancellations", () => {
    expect(
      getGoogleSyncPlan({
        previousContentHashes: { a: "same", b: "old", c: "remove" },
        nextContentHashes: { a: "same", b: "new", d: "new" },
      }),
    ).toEqual({ create: ["d"], update: ["b"], cancel: ["c"] });
  });
});
