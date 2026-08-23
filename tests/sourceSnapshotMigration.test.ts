import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0005_source_snapshot_ingestion.sql",
  "utf8",
);

describe("source snapshot migration contract", () => {
  it("creates configured sources and immutable source snapshots", () => {
    expect(migration).toContain("create table if not exists timetable_sources");
    expect(migration).toContain(
      "create table if not exists timetable_source_snapshots",
    );
    expect(migration).toContain("unique (source_id, content_hash)");
  });

  it("stores the HIT Google Docs source as trusted configuration", () => {
    expect(migration).toContain("'hit-sist-master-sem1-2026'");
    expect(migration).toContain("'google_docs_apps_script'");
    expect(migration).toContain(
      "'1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q'",
    );
  });

  it("keeps relay tables private from anon and authenticated roles", () => {
    expect(migration).toContain(
      "alter table timetable_sources enable row level security;",
    );
    expect(migration).toContain(
      "alter table timetable_source_snapshots enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table timetable_sources from anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke all on table timetable_source_snapshots from anon, authenticated;",
    );
    expect(migration).toContain(
      "grant all on table timetable_sources to service_role;",
    );
    expect(migration).toContain(
      "grant all on table timetable_source_snapshots to service_role;",
    );
  });
});
