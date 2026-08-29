import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0007_source_reconciliation_bindings.sql",
  "utf8",
);

describe("source reconciliation binding migration", () => {
  it("creates an additive private binding table for source reconciliation", () => {
    expect(migration).toContain(
      "create table if not exists timetable_source_reconciliation_bindings",
    );
    expect(migration).toContain("unique (source_key, source_cohort_code)");
  });

  it("keeps bindings private from anon and authenticated roles", () => {
    expect(migration).toContain(
      "alter table timetable_source_reconciliation_bindings enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table timetable_source_reconciliation_bindings from anon, authenticated;",
    );
    expect(migration).toContain(
      "grant all on table timetable_source_reconciliation_bindings to service_role;",
    );
  });

  it("stores the explicit CS.1 binding without fuzzy runtime lookup", () => {
    expect(migration).toContain("'hit-sist-master-sem1-2026'");
    expect(migration).toContain("'CS.1'");
    expect(migration).toContain("'hit-cs-1-1-august-2026'");
    expect(migration).toContain("'1.1'");
    expect(migration).toContain("'August Semester 2026'");
  });
});
