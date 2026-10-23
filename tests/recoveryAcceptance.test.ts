import { describe, expect, it, vi } from "vitest";
import {
  obtainAcceptanceToken,
  validateRecoveryCalendar,
} from "../scripts/recovery-acceptance.mjs";

describe("recovery acceptance boundaries", () => {
  it("signs in once with the test account and retains no session on disk", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "test-token" })),
      );
    expect(
      await obtainAcceptanceToken(
        {
          SUPABASE_URL: "https://example.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
          CALENDERZW_STAGING_ADMIN_EMAIL: "test@example.invalid",
          CALENDERZW_STAGING_ADMIN_PASSWORD: "test-password",
          CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN: "stale-token",
        },
        request,
      ),
    ).toBe("test-token");
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(
      "https://example.supabase.co/auth/v1/token?grant_type=password",
    );
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({
      email: "test@example.invalid",
      password: "test-password",
    });
  });

  it("fails closed on invalid account credentials instead of using a stale token", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response("private-provider-error", { status: 400 }),
      );
    await expect(
      obtainAcceptanceToken(
        {
          SUPABASE_URL: "https://example.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "public-test",
          CALENDERZW_STAGING_ADMIN_EMAIL: "test@example.invalid",
          CALENDERZW_STAGING_ADMIN_PASSWORD: "secret-password",
          CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN: "stale-token",
        },
        request,
      ),
    ).rejects.toThrow("TEST_ACCOUNT_SIGN_IN_FAILED");
  });

  it("never transmits credentials to an insecure auth URL", async () => {
    const request = vi.fn();
    await expect(
      obtainAcceptanceToken(
        {
          SUPABASE_URL: "http://example.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "public-test",
          CALENDERZW_STAGING_ADMIN_EMAIL: "test@example.invalid",
          CALENDERZW_STAGING_ADMIN_PASSWORD: "secret-password",
        },
        request,
      ),
    ).rejects.toThrow("TEST_ACCOUNT_AUTH_CONFIG_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps missing authentication blocking and legacy token compatibility", async () => {
    expect(await obtainAcceptanceToken({})).toBeNull();
    expect(
      await obtainAcceptanceToken({
        CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN: "legacy",
      }),
    ).toBe("legacy");
    await expect(
      obtainAcceptanceToken({ CALENDERZW_STAGING_ADMIN_EMAIL: "incomplete" }),
    ).rejects.toThrow("TEST_ACCOUNT_AUTH_CONFIG_INVALID");
  });

  const event = (uid: string, day: string, time: string, code = "OTHER101") =>
    `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${code} lecture\r\nDTSTART;TZID=Africa/Harare:202608${day}T${time}00\r\nDTEND;TZID=Africa/Harare:202608${day}T${time === "0800" ? "1000" : time === "1215" ? "1315" : "1000"}00\r\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${day === "04" ? "TU" : day === "06" ? "TH" : "WE"}\r\nLOCATION:${day === "06" ? "S107" : "N109"}\r\nEND:VEVENT`;
  const calendar = (events: string[]) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
  const expected = [
    event("tuesday", "04", "1215", "ISE4105"),
    event("thursday", "06", "0800", "ISE4105"),
    ...Array.from({ length: 13 }, (_, i) => event(`other-${i}`, "05", "0900")),
  ];

  it("requires valid calendar structure, distinct UIDs and actual corrected recurring truth", () => {
    expect(validateRecoveryCalendar(calendar(expected))).toBe(true);
    expect(validateRecoveryCalendar("BEGIN:VEVENT".repeat(15))).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar([...expected.slice(0, 14), expected[0]]),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar([
          event("wednesday", "05", "1215", "ISE4105"),
          ...expected.slice(1),
        ]),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replace("BYDAY=TU", "BYDAY=WE"),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replace("INTERVAL=1", "INTERVAL=2"),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replace("INTERVAL=1", "INTERVAL=1;COUNT=1"),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replaceAll("20260804", "20260805"),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replaceAll("20260804", "99999999"),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replace(
          "BEGIN:VEVENT",
          "BEGIN:VEVENT\r\nBEGIN:VEVENT",
        ),
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        calendar(expected).replace("DTEND;", "MISSING;"),
      ),
    ).toBe(false);
  });

  it("reports only fixed failure codes and counts, never private calendar data", () => {
    const diagnostic = vi.fn();
    expect(validateRecoveryCalendar(calendar([]), diagnostic)).toBe(false);
    expect(diagnostic).toHaveBeenCalledWith("EVENT_COUNT", 0);
    diagnostic.mockClear();
    expect(
      validateRecoveryCalendar("private-calendar-payload", diagnostic),
    ).toBe(false);
    expect(diagnostic).toHaveBeenCalledWith("CALENDAR_ENVELOPE");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      "private-calendar-payload",
    );
  });

  it("compares an original ICS-class feed to that class's canonical calendar, not SE", () => {
    const icsClass = calendar(expected).replaceAll("ISE4105", "ICS1101");
    expect(validateRecoveryCalendar(icsClass, undefined, icsClass)).toBe(true);
    expect(
      validateRecoveryCalendar(icsClass, undefined, calendar(expected)),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        icsClass.replace("LOCATION:N109", "LOCATION:Wrong venue"),
        undefined,
        icsClass,
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        icsClass.replace("UID:tuesday", "UID:replacement"),
        undefined,
        icsClass,
      ),
    ).toBe(false);
    expect(
      validateRecoveryCalendar(
        icsClass.replace(
          "END:VEVENT",
          "BEGIN:VALARM\r\nDESCRIPTION:Private reminder\r\nTRIGGER:-PT30M\r\nEND:VALARM\r\nEND:VEVENT",
        ),
        undefined,
        icsClass,
      ),
    ).toBe(true);
  });
});
