import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0002_timetable_import_pipeline.sql",
  "utf8",
);

describe("timetable import migration contract", () => {
  it("creates normalized timetable import tables", () => {
    for (const table of [
      "academic_units",
      "programmes",
      "cohorts",
      "academic_periods",
      "courses",
      "source_documents",
      "programme_courses",
      "import_batches",
      "import_candidates",
      "import_candidate_warnings",
      "timetable_sessions",
      "timetable_session_exceptions",
      "verification_records",
      "audit_logs",
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
  });

  it("keeps source uploads private and limited to supported timetable formats", () => {
    expect(migration).toContain("insert into storage.buckets");
    expect(migration).toContain("'timetable-sources'");
    expect(migration).toContain("false");
    expect(migration).toContain("'application/pdf'");
    expect(migration).toContain(
      "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    );
    expect(migration).toContain("'text/csv'");
  });

  it("enables RLS and uses app metadata for import-admin authorization", () => {
    expect(migration).toContain(
      "alter table import_batches enable row level security;",
    );
    expect(migration).toContain(
      "alter table import_candidates enable row level security;",
    );
    expect(migration).toContain(
      "alter table source_documents enable row level security;",
    );
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'");
    expect(migration).not.toContain("user_metadata");
  });

  it("models traceability and forbids draft sources from becoming silent official records", () => {
    expect(migration).toContain("source_document_id");
    expect(migration).toContain("source_candidate_id");
    expect(migration).toContain("source_is_draft boolean not null default false");
    expect(migration).toContain(
      "verification_status in ('unverified', 'community_verified', 'official')",
    );
    expect(migration).toContain("unique (timetable_version_id, stable_session_key)");
  });
});
