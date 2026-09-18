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
const repository = readFileSync(
  "server/staticTimetableImportRepository.ts",
  "utf8",
);
const reviewPage = readFileSync("src/StaticTimetableImportPage.tsx", "utf8");
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

  it("persists parse evidence atomically and keeps identical imports idempotent", () => {
    expect(migration).toContain("persist_static_document_import");
    expect(migration).toContain("import_batches_static_docx_idempotency_unique");
    expect(migration).toContain(
      "on conflict (source_document_id, parser_version)",
    );
    expect(repository).toContain('.rpc("persist_static_document_import"');
    expect(repository).toContain("/${sha256}/source.docx`");
  });

  it("keeps document import draft-only and uses the installed digest schema explicitly", () => {
    expect(migration).toContain("materialize_static_document_draft");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("'static_document'");
    expect(migration).toContain("'draft'");
    expect(migration).not.toContain("current_published_version_id = v_version_id");
    expect(staticApi).toContain("/api/admin/static-timetable-imports");
    expect(staticApi).toContain('action === "draft"');
    expect(staticApi).not.toContain("/publish");
  });

  it("requires operational-admin auth and constrains DOCX upload content", () => {
    expect(adminApi).toContain("requireOperationalAdmin");
    expect(adminApi).toContain("handleStaticTimetableImportAdminApi");
    expect(staticApi).toContain("DOCX_MIME_REQUIRED");
    expect(staticApi).toContain("ACCEPTED_DOCX_MIME_TYPES");
    expect(staticApi).not.toContain("details: error.details");
    expect(main).toContain("/admin/static-import");
    expect(main).toContain("StaticTimetableImportPage");
  });

  it("shows the reviewer sessions, references, ignored rows and unparsed evidence", () => {
    expect(reviewPage).toContain("Session verification");
    expect(reviewPage).toContain("Course reference evidence");
    expect(reviewPage).toContain("Unparsed timetable-looking cells");
    expect(reviewPage).toContain("Ignored structural evidence");
    expect(reviewPage).toContain("sourceTableIndex");
    expect(reviewPage).toContain("rawText");
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
