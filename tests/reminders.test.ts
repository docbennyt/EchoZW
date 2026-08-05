import { describe, expect, it } from "vitest";
import { validateReminderMinutes } from "../src/domain/reminders";

describe("reminder validation", () => {
  it("deduplicates and sorts supported reminders", () => {
    expect(validateReminderMinutes([30, 720, 30])).toEqual([720, 30]);
  });

  it("rejects unsupported reminder values", () => {
    expect(() => validateReminderMinutes([999])).toThrow(
      "Unsupported reminder value",
    );
  });

  it("limits reminder spam", () => {
    expect(() => validateReminderMinutes([5, 10, 15, 30, 45, 60])).toThrow(
      "one to five reminders",
    );
  });
});
