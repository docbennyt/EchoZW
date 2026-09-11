import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cockpit = readFileSync("src/FounderOperationsCockpit.tsx", "utf8");
const styles = readFileSync("src/founderOperationsCockpit.css", "utf8");
const compactCockpit = cockpit.replace(/\s+/g, " ");

describe("DR-45/DR-65 founder operations cockpit", () => {
  it("puts operational signal before setup CRUD and uses truthful activation semantics", () => {
    expect(cockpit).toContain("7-day pilot command center");
    expect(cockpit).toContain("Know what needs attention before opening CRUD.");
    expect(compactCockpit).toContain(
      "Verified activation requires successful Google calendar creation or sync evidence, or an observed update-enabled feed request.",
    );
    expect(cockpit).toContain("Add-to-Calendar starts");
    expect(cockpit).toContain("Provider handoffs");
    expect(cockpit).toContain("Google connections completed");
    expect(cockpit).toContain("Verified activations");
    expect(cockpit).toContain("Feed observed");
    expect(cockpit).toContain("One-time ICS downloads");
    expect(compactCockpit).toContain("Creating a subscription record");
    expect(cockpit).not.toContain("Active users");
  });

  it("uses the DR-65 strict funnel while preserving the legacy funnel in the API", () => {
    expect(cockpit).toContain("overview?.conversionFunnel");
    expect(cockpit).toContain("provider_handoff_prepared");
    expect(cockpit).toContain("verified_activation");
    expect(compactCockpit).toContain(
      "The legacy funnel remains available for historical continuity.",
    );
  });

  it("keeps subscriber identity and private feed material out of the cockpit contract", () => {
    expect(cockpit).toContain("no raw");
    expect(cockpit).not.toContain("phone_e164");
    expect(cockpit).not.toContain("token_hash");
    expect(cockpit).not.toContain("feed_token");
    expect(cockpit).not.toContain("subscriber_profile_id");
  });

  it("provides premium responsive hierarchy without sacrificing mobile usability", () => {
    expect(styles).toContain(".foc-hero");
    expect(styles).toContain(".foc-pulse-grid");
    expect(styles).toContain(".foc-split-grid");
    expect(styles).toContain("@media (max-width: 680px)");
    expect(styles).toContain("@media (max-width: 460px)");
  });

  it("keeps Class Rep operations and timetable trust visible from the command center", () => {
    expect(cockpit).toContain("Timetable trust");
    expect(cockpit).toContain("Class Rep operations");
    expect(cockpit).toContain('href="/admin/team"');
    expect(cockpit).toContain('href="/admin/timetables"');
  });
});
