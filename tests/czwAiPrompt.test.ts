// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-174 classification-first AI workbook prompt", () => {
  const legacyPrompt = readFileSync(
    "public/templates/czw-timetable-ai-prompt-v1.1.md",
    "utf8",
  );
  const workbookPrompt = readFileSync(
    "public/templates/czw-timetable-ai-workbook-prompt-v2.md",
    "utf8",
  );
  const importPage = readFileSync("src/StaticTimetableImportPage.tsx", "utf8");

  it("retains classification-first source analysis from the earlier revision", () => {
    expect(legacyPrompt).toContain("IMPORTANT: CLASSIFY BEFORE YOU EXTRACT");
    expect(legacyPrompt).toContain("GRID_TIME_ROWS_DAY_COLUMNS");
    expect(legacyPrompt).toContain("GRID_DAY_ROWS_TIME_COLUMNS");
    expect(legacyPrompt).toContain("HYBRID_GRID_PLUS_CATALOGUE");
  });

  it("serves a real workbook-first prompt, not the original JSON-only request", () => {
    expect(importPage).toContain(
      "/templates/czw-timetable-ai-workbook-prompt-v2.md",
    );
    expect(importPage).toContain("response.ok");
    expect(importPage).toContain("text/html");
    expect(workbookPrompt).toContain(
      "Your ONLY successful deliverable is the ACTUAL completed",
    );
    expect(workbookPrompt).toContain("CZW Timetable Import v1.xlsx");
    expect(workbookPrompt).toContain(
      'Set version literally to "czw-import-format-v1"',
    );
    expect(workbookPrompt).toContain(
      "do not turn it into a conversation",
    );
  });

  it("locks the four canonical tabs and safe extraction checks", () => {
    for (const tab of ['"Source"', '"Targets"', '"Courses"', '"Sessions"']) {
      expect(workbookPrompt).toContain(tab);
    }
    expect(workbookPrompt).toContain(
      "target_key | course_code | course_name | weekday | start_time | end_time | venue | lecturer | delivery_mode",
    );
    expect(workbookPrompt).toContain("24-hour TEXT");
    expect(workbookPrompt).toContain("NEEDS HUMAN REVIEW");
    expect(workbookPrompt).toContain("DOES NOT automatically ingest");
    expect(workbookPrompt).toContain("EXAM timetable");
    expect(workbookPrompt).toContain("Reconcile EACH target+weekday");
    expect(workbookPrompt).toContain(
      "STOP and explicitly say what is impossible",
    );
  });

  it("retains the frozen import version and original prompt for compatibility", () => {
    expect(
      readFileSync("public/templates/czw-timetable-ai-prompt-v1.md", "utf8"),
    ).toContain("CalenderZW Import Format v1");
    expect(workbookPrompt).toContain("czw-import-format-v1");
  });
});
