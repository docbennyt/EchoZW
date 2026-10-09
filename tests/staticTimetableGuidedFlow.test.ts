import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-level contract for the guided DR-161 operator workflow.

const page = readFileSync("src/StaticTimetableImportPage.tsx", "utf8");
const parser = readFileSync("src/domain/staticTimetableDocument.ts", "utf8");
const client = readFileSync("src/staticTimetableImportClient.ts", "utf8");
const api = readFileSync("server/staticTimetableImportApi.ts", "utf8");
const repository = readFileSync(
  "server/staticTimetableImportRepository.ts",
  "utf8",
);

describe("DR-161 guided static timetable workflow", () => {
  it("uses the v3 parser boundary and keeps raw academic-year evidence", () => {
    expect(parser).toContain("static-docx-matrix-v3");
    expect(parser).toContain("academicYearRaw");
  });

  it("reuses canonical Admin creation APIs instead of introducing a parallel CRUD model", () => {
    expect(page).toContain("createProgramme");
    expect(page).toContain("createClassGroup");
    expect(page).toContain("createAcademicPeriod");
    expect(page).toContain("Create & use");
    expect(page).not.toContain("import_programmes");
    expect(page).not.toContain(".from(");
  });

  it("persists mapping per import target and validates relationships server-side", () => {
    expect(client).toContain("patchStaticTimetableTargetMapping");
    expect(api).toContain("/targets/");
    expect(repository).toContain("updateStaticTimetableImportTargetMapping");
    expect(repository).toContain(
      "Programme must belong to the source institution.",
    );
    expect(repository).toContain(
      "Class must belong to the selected programme.",
    );
    expect(repository).toContain(
      "Academic period must belong to the source institution.",
    );
  });

  it("keeps cohort choice scoped to a selected programme and supports shared mappings", () => {
    expect(page).toContain("if (!selectedMapping.programmeId) return [];");
    expect(page).toContain("Choose or create a programme first.");
    expect(page).toContain("applyProgrammeToAll");
    expect(page).toContain("applyPeriodToAll");
    expect(page).not.toContain("applyCohortToAll");
  });

  it("uses exception-first review and keeps forensic evidence secondary", () => {
    expect(page).toContain("Resolve exceptions, not the whole document");
    expect(page).toContain("View and edit all");
    expect(page).toContain("Source evidence · read-only audit trail");
    expect(page).toContain("Nothing will be published.");
  });

  it("can resume a persisted import review by batch id", () => {
    expect(page).toContain('get("batch")');
    expect(page).toContain("/admin/static-import?batch=");
    expect(client).toContain("getStaticTimetableImport");
  });
});
