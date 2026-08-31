import { describe, expect, it } from "vitest";
import {
  classifyAnalyticsClient,
  isAnalyticsUuid,
  sanitizeAnalyticsProperties,
} from "../src/domain/analytics";

describe("analytics privacy domain", () => {
  it("keeps only allowlisted primitive event properties", () => {
    expect(
      sanitizeAnalyticsProperties({
        publicSlug: "hit-ics-1-1-august-semester-2026",
        provider: "webcal_subscription",
        versionNumber: 4,
        token: "must-never-be-stored",
        email: "student@example.com",
        nested: { unsafe: true },
      }),
    ).toEqual({
      publicSlug: "hit-ics-1-1-august-semester-2026",
      provider: "webcal_subscription",
      versionNumber: 4,
    });
  });

  it("recognizes UUID analytics identities", () => {
    expect(isAnalyticsUuid("4b3f08c9-78b7-4af5-9a2b-dc859fabcf63")).toBe(true);
    expect(isAnalyticsUuid("not-a-uuid")).toBe(false);
  });

  it("classifies only coarse client families", () => {
    expect(
      classifyAnalyticsClient(
        "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toEqual({
      deviceKind: "mobile",
      browserFamily: "chrome",
      osFamily: "android",
    });

    expect(
      classifyAnalyticsClient(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({
      deviceKind: "mobile",
      browserFamily: "safari",
      osFamily: "ios",
    });
  });
});
