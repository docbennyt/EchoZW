import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-64 student conversion source contract", () => {
  it("removes pre-handoff contact collection and cosmetic success step", () => {
    const source = readFileSync("src/PublicTimetableReliability.tsx", "utf8");
    expect(source).not.toContain("contact_optional");
    expect(source).not.toContain("subscriberCountryOptions");
    expect(source).not.toContain("normalizeSubscriberPhone");
    expect(source).not.toContain('onboardingStep === "success"');
    expect(source).toContain("calendarActionLockRef");
  });

  it("gates optional public surfaces on durable server-returned settings", () => {
    const source = readFileSync("src/PublicTimetableReliability.tsx", "utf8");
    expect(source).toContain("publicDisplay?.showVisualPreview === true");
    expect(source).toContain("publicDisplay?.showChangeAlerts === true");
  });

  it("uses neutral calendar iconography instead of unlicensed provider logo approximations", () => {
    const source = readFileSync("src/PublicTimetableReliability.tsx", "utf8");
    expect(source).not.toContain('provider === "google" ? "G" : ""');
    expect(source).toContain("<CalendarCheck size={18} />");
  });

  it("contains explicit mobile and desktop conversion layout contracts", () => {
    const css = readFileSync("src/publicTimetableReliability.css", "utf8");
    expect(css).toContain("@media (min-width: 900px)");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.65fr)",
    );
    expect(css).toContain("@media (max-width: 899px)");
  });
});
