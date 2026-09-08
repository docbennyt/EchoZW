import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("DR-58 academic pause controls", () => {
  it("mounts pause controls into both Class Rep and Founder operational surfaces", () => {
    const classRep = source("src/ClassRepCorrectionSafetyEnhancement.tsx");
    const founder = source("src/FounderOperationsCockpit.tsx");
    expect(classRep).toContain("<ClassRepAcademicPauseAction");
    expect(classRep).toContain("<ActiveAcademicPauseNotice");
    expect(founder).toContain("<AdminAcademicPauseControl");
  });

  it("keeps broad pause routes behind operational-admin auth and scoped routes behind timetable-editor auth", () => {
    const routes = source("server/adminApi.ts");
    expect(routes).toContain("requireTimetableEditor(req, timetableId, deps)");
    expect(routes).toContain("requireOperationalAdmin(req, deps)");
    expect(routes).toContain(
      'requestUrl.pathname.startsWith("/api/admin/academic-pauses")',
    );
  });

  it("restricts Class Reps to their assigned timetable or session", () => {
    const repository = source("server/academicPauseRepository.ts");
    expect(repository).toContain(
      'input.scopeType !== "timetable" && input.scopeType !== "session"',
    );
    expect(repository).toContain(
      "This timetable is not assigned to your Class Rep account.",
    );
    expect(repository).toContain(
      "Class Reps cannot resume institution or programme pauses.",
    );
  });

  it("supports Admin listing and resuming broad pauses", () => {
    const api = source("server/academicPauseAdminApi.ts");
    const client = source("src/api/academicPauses.ts");
    expect(api).toContain("pauses: await listAcademicPauses()");
    expect(client).toContain("listAcademicPauses");
    expect(client).toContain("deactivateBroadPause");
  });

  it("does not leave one-shot DR-58 wiring workflows in the review branch", () => {
    expect(
      existsSync(resolve(process.cwd(), ".github/workflows/dr58-finish.yml")),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), ".github/workflows/dr58-apply.yml")),
    ).toBe(false);
  });
});
