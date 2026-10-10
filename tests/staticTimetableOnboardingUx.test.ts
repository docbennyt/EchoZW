import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminWorkspace = readFileSync("src/pilotMvp.tsx", "utf8");

describe("static timetable import discoverability", () => {
  it("makes document upload a first-class Admin navigation path", () => {
    expect(adminWorkspace).toContain(
      '{ href: "/admin/static-import", label: "Upload timetable" }',
    );
  });

  it("puts DOCX upload before manual timetable entry in the Timetables onboarding flow", () => {
    const uploadPromptIndex = adminWorkspace.indexOf(
      "<TimetableDocumentUploadPrompt />",
    );
    const manualFormIndex = adminWorkspace.indexOf("<TimetableSetupForm");

    expect(uploadPromptIndex).toBeGreaterThan(-1);
    expect(manualFormIndex).toBeGreaterThan(-1);
    expect(uploadPromptIndex).toBeLessThan(manualFormIndex);
    expect(adminWorkspace).toContain("Upload timetable document");
    expect(adminWorkspace).toContain(
      "DOCX, Excel, CSV or PDF to review draft.",
    );
    expect(adminWorkspace).toContain("Fallback for unsupported formats.");
  });
});
