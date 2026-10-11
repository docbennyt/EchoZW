// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-174 classification-first CZW AI prompt", () => {
  const promptPath = "public/templates/czw-timetable-ai-prompt-v1.1.md";
  const prompt = readFileSync(promptPath, "utf8");
  const importPage = readFileSync("src/StaticTimetableImportPage.tsx", "utf8");

  it("forces timetable scope and layout classification before extraction", () => {
    expect(prompt).toContain("IMPORTANT: CLASSIFY BEFORE YOU EXTRACT");
    expect(prompt).toContain("Identify the timetable SCOPE");
    expect(prompt).toContain("Identify the primary LAYOUT");
    expect(prompt).toContain("GRID_TIME_ROWS_DAY_COLUMNS");
    expect(prompt).toContain("GRID_DAY_ROWS_TIME_COLUMNS");
    expect(prompt).toContain("MULTI_BLOCK_GRID");
    expect(prompt).toContain("HYBRID_GRID_PLUS_CATALOGUE");
  });

  it("locks high-risk extraction guardrails for weaker models", () => {
    expect(prompt).toContain("Do not stop after extracting the first target or first page.");
    expect(prompt).toContain("Never fuzzy-match similar codes.");
    expect(prompt).toContain("hoursPerWeek must come from explicit source evidence.");
    expect(prompt).toContain("create ONE continuous session");
    expect(prompt).toContain("TARGET_ASSIGNMENT_UNCLEAR");
    expect(prompt).toContain("FINAL SELF-CHECK BEFORE YOU ANSWER");
  });

  it("keeps the frozen v1 machine contract while the UI serves prompt v1.1", () => {
    expect(prompt).toContain('"version": "czw-import-format-v1"');
    expect(prompt).toContain(
      "exactly these top-level keys: version, source, targets, courses, sessions, issues",
    );
    expect(importPage).toContain(
      "/templates/czw-timetable-ai-prompt-v1.1.md",
    );
    expect(
      readFileSync("public/templates/czw-timetable-ai-prompt-v1.md", "utf8"),
    ).toContain("CalenderZW Import Format v1");
  });
});
