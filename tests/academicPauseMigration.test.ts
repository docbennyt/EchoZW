import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0023_academic_schedule_pauses.sql",
  "utf8",
);

describe("DR-58 academic pause migration", () => {
  it("stores pauses non-destructively at scalable scopes", () => {
    expect(migration).toContain(
      "create table if not exists public.academic_schedule_pauses",
    );
    expect(migration).toContain(
      "'institution', 'programme', 'cohort', 'timetable', 'session'",
    );
    expect(migration).toContain("stable_session_key text");
    expect(migration).toContain("academic_schedule_pauses_scope_target_check");
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.timetable_sessions/i,
    );
  });

  it("supports Sim Break, Graduation, SWOT and bounded closures", () => {
    expect(migration).toContain(
      "'sim_break', 'graduation', 'swot_week', 'holiday', 'closure', 'other'",
    );
    expect(migration).toContain("all_day boolean not null default true");
    expect(migration).toContain("starts_at timestamptz");
    expect(migration).toContain("ends_at timestamptz");
    expect(migration).toContain("ends_on >= starts_on");
  });

  it("keeps pause records server-owned and auditable", () => {
    expect(migration).toContain("creator_staff_user_id uuid not null");
    expect(migration).toContain("disabled_by_staff_user_id uuid");
    expect(migration).toContain(
      "alter table public.academic_schedule_pauses enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.academic_schedule_pauses from anon, authenticated",
    );
    expect(migration).toContain(
      "grant all on table public.academic_schedule_pauses to service_role",
    );
  });
});
