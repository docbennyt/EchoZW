import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_HOME_URL,
  getRememberedGoogleCalendarReturnSlug,
  googleCalendarFailureRecoveryPath,
  rememberGoogleCalendarReturnSlug,
  shouldAutoOpenGoogleCalendar,
} from "../src/domain/googleCalendarHandoff";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("Google Calendar handoff", () => {
  it("uses the canonical Google Calendar destination", () => {
    expect(GOOGLE_CALENDAR_HOME_URL).toBe(
      "https://calendar.google.com/calendar/r",
    );
  });

  it("remembers the timetable before OAuth and recovers failed callbacks away from Find my timetable", () => {
    const storage = memoryStorage();
    rememberGoogleCalendarReturnSlug(
      "hit-ics-1-1-august-semester-2026",
      storage,
      1_000,
    );

    expect(getRememberedGoogleCalendarReturnSlug(storage, 2_000)).toBe(
      "hit-ics-1-1-august-semester-2026",
    );
    expect(
      googleCalendarFailureRecoveryPath("google-failed", storage, 2_000),
    ).toBe(
      "/t/hit-ics-1-1-august-semester-2026?calendar=google-failed&reason=google-failed",
    );
    expect(
      googleCalendarFailureRecoveryPath("access_denied", storage, 2_000),
    ).toBe(
      "/t/hit-ics-1-1-august-semester-2026?calendar=google-failed&reason=access_denied",
    );
  });

  it("does not recover a stale OAuth attempt", () => {
    const storage = memoryStorage();
    rememberGoogleCalendarReturnSlug("class-a", storage, 1_000);

    expect(
      getRememberedGoogleCalendarReturnSlug(storage, 31 * 60 * 1000 + 1_000),
    ).toBeNull();
    expect(
      googleCalendarFailureRecoveryPath(
        "google-failed",
        storage,
        31 * 60 * 1000 + 1_000,
      ),
    ).toBeNull();
  });

  it("never converts a success callback into a failure recovery", () => {
    const storage = memoryStorage();
    rememberGoogleCalendarReturnSlug("class-a", storage, 1_000);
    expect(
      googleCalendarFailureRecoveryPath("google-success", storage, 2_000),
    ).toBeNull();
  });

  it("auto-opens Google Calendar only once per subscription in a browser session", () => {
    const storage = memoryStorage();
    expect(shouldAutoOpenGoogleCalendar("sub-1", storage)).toBe(true);
    expect(shouldAutoOpenGoogleCalendar("sub-1", storage)).toBe(false);
    expect(shouldAutoOpenGoogleCalendar("sub-2", storage)).toBe(true);
  });
});
