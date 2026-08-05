import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  productionPlaceholderPatterns,
  validateLegalProductionConfig,
} from "../src/domain/legalValidation";
import {
  allowedGoogleCalendarScopes,
  disallowedGoogleCalendarScopes,
  googleCalendarScope,
} from "../src/domain/googleScopes";

describe("legal and Google OAuth configuration", () => {
  it("allows only the calendar.app.created Google Calendar scope", () => {
    expect(allowedGoogleCalendarScopes).toEqual([
      "https://www.googleapis.com/auth/calendar.app.created",
    ]);
    expect(googleCalendarScope).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
    expect(allowedGoogleCalendarScopes).not.toEqual(
      expect.arrayContaining([...disallowedGoogleCalendarScopes]),
    );
  });

  it("rejects production legal placeholder values", () => {
    expect(() =>
      validateLegalProductionConfig({
        LEGAL_OPERATOR_NAME: "Your Company",
        LEGAL_TRADING_NAME: "CalenderZW",
        LEGAL_OPERATOR_ADDRESS: "TODO",
        LEGAL_COUNTRY: "Zimbabwe",
        LEGAL_SUPPORT_EMAIL: "support@aido.co.zw",
        LEGAL_PRIVACY_EMAIL: "privacy@aido.co.zw",
        LEGAL_EFFECTIVE_DATE: "2026-08-05",
        LEGAL_LAST_UPDATED_DATE: "2026-08-05",
        PUBLIC_APP_URL: "http://localhost:5173",
        LEGAL_MINIMUM_AGE: "13",
        LEGAL_GOVERNING_LAW: "",
        LEGAL_DISPUTE_VENUE: "",
      }),
    ).toThrow();
  });

  it("accepts complete HTTPS production legal config", () => {
    expect(() =>
      validateLegalProductionConfig({
        LEGAL_OPERATOR_NAME: "aiDo",
        LEGAL_TRADING_NAME: "CalenderZW",
        LEGAL_OPERATOR_ADDRESS: "Reviewed operator address",
        LEGAL_COUNTRY: "Zimbabwe",
        LEGAL_SUPPORT_EMAIL: "support@aido.co.zw",
        LEGAL_PRIVACY_EMAIL: "privacy@aido.co.zw",
        LEGAL_EFFECTIVE_DATE: "2026-08-05",
        LEGAL_LAST_UPDATED_DATE: "2026-08-05",
        PUBLIC_APP_URL: "https://calender.aido.co.zw",
        LEGAL_MINIMUM_AGE: "13",
        LEGAL_GOVERNING_LAW: "Zimbabwe",
        LEGAL_DISPUTE_VENUE: "Zimbabwe",
      }),
    ).not.toThrow();
  });

  it("ships public legal pages as readable HTML without client JavaScript", () => {
    const files = [
      "public/privacy/index.html",
      "public/terms/index.html",
      "public/data-deletion/index.html",
    ];

    for (const file of files) {
      const html = readFileSync(file, "utf8");
      expect(html).toContain("<h1>");
      expect(html).not.toContain("<script");
      expect(html).toContain("https://calender.aido.co.zw");
      expect(html).toMatch(/mailto:(privacy|support)@aido\.co\.zw/);
      for (const pattern of productionPlaceholderPatterns) {
        expect(pattern.test(html)).toBe(false);
      }
    }
  });
});
