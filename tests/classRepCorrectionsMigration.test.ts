import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0010_class_rep_corrections_and_exceptions.sql",
  "utf8",
);

describe("class rep corrections migration", () => {
  it("extends staff users with server-managed contact metadata", () => {
    expect(migration).toContain("add column if not exists email text");
    expect(migration).toContain("staff_users_email_unique_idx");
    expect(migration).toContain("lower(email)");
  });

  it("creates recurring correction directives with replacement semantics", () => {
    expect(migration).toContain(
      "create table if not exists public.timetable_correction_directives",
    );
    expect(migration).toContain(
      "action text not null check (action in ('add', 'modify', 'remove'))",
    );
    expect(migration).toContain(
      "source_may_replace boolean not null default false",
    );
    expect(migration).toContain("creator_role text not null");
    expect(migration).toContain("superseded_by_source_snapshot_id uuid");
    expect(migration).toContain(
      "alter table public.timetable_correction_directives enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.timetable_correction_directives from anon, authenticated",
    );
  });

  it("allows extra one-off classes without a fake existing session", () => {
    expect(migration).toContain(
      "alter column timetable_session_id drop not null",
    );
    expect(migration).toContain("exception_type = 'extra'");
    expect(migration).toContain("and timetable_session_id is null");
    expect(migration).toContain("and timetable_id is not null");
    expect(migration).toContain("and course_code is not null");
  });

  it("indexes scoped correction and exception reads", () => {
    expect(migration).toContain(
      "timetable_correction_directives_timetable_idx",
    );
    expect(migration).toContain(
      "timetable_session_exceptions_timetable_date_idx",
    );
  });
});
