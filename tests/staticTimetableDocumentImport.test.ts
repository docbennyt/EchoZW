import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0031_static_timetable_document_import.sql",
  "utf8",
);
const watcherGuard = readFileSync(
  "supabase/migrations/0032_static_document_watcher_guard.sql",
  "utf8",
);
const adminApi = readFileSync("server/adminApi.ts", "utf8");
const staticApi = readFileSync("server/staticTimetableImportApi.ts", "utf8");
const main = readFileSync("src/main.tsx", "utf8");
const docs = readFileSync("docs/DOCX_IMPORT_SPEC.md", "utf8");

describe("DR-120 static document import architecture", () => {
  it("models source authority explicitly and blocks watcher draft generation for static timetables", () => {
    expect(migration).toContain("source_strategy text not null default 'manual'");
    expect(migration).toContain("'live_managed_source', 'static_document', 'hybrid'");
    expect(watcherGuard).toContain("t.source_strategy = 'static_document'");
    expect(watcherGuard).toContain("status := 'skipped'");
    expect(migration).toContain("'live_managed_source'");
  });

  it("keeps document import duplicate-aware and draft-only", () => {
    expect(migration).toContain("import_batches_static_docx_idempotency_unique");
    expect(migration).toContain("materialize_static_document_draft");
    expect(migration).toContain("'static_document'");
    expect(migration).toContain("'draft'");
    expect(migration).not.toContain("current_published_version_id = v_version_id");
    expect(staticApi).toContain("/api/admin/static-timetable-imports");
    expect(staticApi).toContain("/draft");
    expect(staticApi).not.toContain("/publish");
  });

  it("requires operational-admin auth and exposes a dedicated verification surface", () => {
    expect(adminApi).toContain("requireOperationalAdmin");
    expect(adminApi).toContain("handleStaticTimetableImportAdminApi");
    expect(main).toContain("/admin/static-import");
    expect(main).toContain("StaticTimetableImportPage");
  });

  it("documents the exact HIT Biotechnology conservation invariants", () => {
    expect(docs).toContain("14 timetable sessions");
    expect(docs).toContain("28 timetable contact hours");
    expect(docs).toContain("6 course-reference rows");
    expect(docs).toContain("ICS 1110");
    expect(docs).toContain("SBT 1104");
    expect(docs).toContain("never silently");
  });
});
