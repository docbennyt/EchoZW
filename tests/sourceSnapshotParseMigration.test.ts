import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0006_source_snapshot_parse_runs.sql",
  "utf8",
);

describe("source snapshot parse run migration", () => {
  it("creates an additive parse run table keyed by snapshot and parser version", () => {
    expect(migration).toContain(
      "create table if not exists timetable_source_parse_runs",
    );
    expect(migration).toContain("unique (snapshot_id, parser_version)");
    expect(migration).toContain(
      "status text not null check (status in ('parsed', 'review_required', 'failed'))",
    );
  });

  it("keeps parse runs private from anon and authenticated roles", () => {
    expect(migration).toContain(
      "alter table timetable_source_parse_runs enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table timetable_source_parse_runs from anon, authenticated;",
    );
    expect(migration).toContain(
      "grant all on table timetable_source_parse_runs to service_role;",
    );
  });
});
