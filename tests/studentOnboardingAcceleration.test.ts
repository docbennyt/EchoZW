import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_HOME_URL,
  googleCalendarHandoffKey,
  shouldAutoOpenGoogleCalendar,
} from "../src/StudentOnboardingAcceleration";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("student Google Calendar handoff", () => {
  it("uses the canonical Google Calendar destination", () => {
    expect(GOOGLE_CALENDAR_HOME_URL).toBe(
      "https://calendar.google.com/calendar/r",
    );
  });

  it("auto-opens once per OAuth completion in the current browser session", () => {
    const storage = memoryStorage();

    expect(shouldAutoOpenGoogleCalendar("subscription-1", storage)).toBe(true);
    expect(shouldAutoOpenGoogleCalendar("subscription-1", storage)).toBe(false);
    expect(shouldAutoOpenGoogleCalendar("subscription-2", storage)).toBe(true);
  });

  it("uses a stable handoff key when subscription identity is unavailable", () => {
    expect(googleCalendarHandoffKey(null)).toBe(
      "calenderzw_google_calendar_handoff_unknown",
    );
  });
});
