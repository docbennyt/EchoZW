import { describe, expect, it } from "vitest";
import { normalizeSubscriberPhone } from "../src/domain/subscriberContact";

describe("subscriber contact normalization", () => {
  it("normalizes common Zimbabwe phone formats to E.164", () => {
    const base = {
      countryCode: "ZW" as const,
      consentUpdates: true as const,
      consentSource: "calendar_onboarding" as const,
    };

    expect(
      normalizeSubscriberPhone({ ...base, phone: "077 123 4567" }),
    ).toMatchObject({
      countryCode: "ZW",
      phoneE164: "+263771234567",
    });
    expect(
      normalizeSubscriberPhone({ ...base, phone: "+26377 123 4567" }),
    ).toMatchObject({
      phoneE164: "+263771234567",
    });
    expect(
      normalizeSubscriberPhone({ ...base, phone: "263771234567" }),
    ).toMatchObject({
      phoneE164: "+263771234567",
    });
  });

  it("rejects invalid phone values so users can skip instead", () => {
    expect(() =>
      normalizeSubscriberPhone({
        countryCode: "ZW",
        phone: "123",
        consentUpdates: true,
        consentSource: "calendar_onboarding",
      }),
    ).toThrow("Enter a valid phone number or skip this step.");
  });
});
