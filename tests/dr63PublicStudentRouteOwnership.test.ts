import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("src/main.tsx", "utf8");
const publicRoute = readFileSync("src/PublicTimetableReliability.tsx", "utf8");
const preview = readFileSync("src/PersonalTimetablePreview.tsx", "utf8");
const disconnect = readFileSync(
  "src/GoogleCalendarDisconnectEntry.tsx",
  "utf8",
);

describe("DR-63 canonical public student route", () => {
  it("has one route owner instead of sibling enhancement controllers", () => {
    expect(main).toContain("return <PublicTimetableReliability slug={slug} />");
    expect(main).not.toContain("TimetableGoogleOnboardingEnhancement");
    expect(main).not.toContain("StudentOnboardingAcceleration");
    expect(main).not.toContain("<PersonalTimetablePreview slug={slug}");
    expect(main).not.toContain("<GoogleCalendarDisconnectEntry");
  });

  it("fetches the public timetable once and passes the same instance to preview", () => {
    expect(publicRoute.match(/fetchPublicTimetable\(slug\)/g)).toHaveLength(1);
    expect(publicRoute).toContain(
      "<PersonalTimetablePreview slug={slug} timetable={timetable} />",
    );
    expect(preview).not.toContain("fetchPublicTimetable");
    expect(preview).not.toContain("MutationObserver");
    expect(preview).not.toContain("querySelector");
  });

  it("keeps Google direct sync inside the same provider state machine", () => {
    expect(publicRoute).toContain('provider: "google_api"');
    expect(publicRoute).toContain("createCalendarSubscription({");
    expect(publicRoute).toContain(
      "window.location.assign(response.googleConnectUrl)",
    );
    expect(publicRoute).toContain("rememberGoogleCalendarReturnSlug");
    expect(publicRoute).toContain("shouldAutoOpenGoogleCalendar");
  });

  it("renders disconnect as a normal child with explicit connection props", () => {
    expect(publicRoute).toContain("<GoogleCalendarDisconnectEntry");
    expect(publicRoute).toContain("connected={googleSuccess}");
    expect(disconnect).not.toContain("MutationObserver");
    expect(disconnect).not.toContain("querySelector");
    expect(disconnect).not.toContain("createPortal");
  });
});
