import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0030_timetable_public_settings.sql",
  "utf8",
);

describe("DR-62 timetable public settings migration", () => {
  it("creates fail-closed timetable display flags with audit provenance", () => {
    expect(migration).toContain(
      "create table if not exists public.timetable_public_settings",
    );
    expect(migration).toContain(
      "show_visual_preview boolean not null default false",
    );
    expect(migration).toContain(
      "show_change_alerts boolean not null default false",
    );
    expect(migration).toContain(
      "updated_at timestamptz not null default now()",
    );
    expect(migration).toContain("updated_by_staff_user_id uuid");
    expect(migration).toContain(
      "references public.staff_users(id) on delete set null",
    );
  });

  it("backfills every existing timetable with both optional surfaces off", () => {
    expect(migration).toMatch(
      /insert into public\.timetable_public_settings[\s\S]*from public\.timetables[\s\S]*on conflict \(timetable_id\) do nothing/i,
    );
    expect(migration).toMatch(/select\s+id,\s+false,\s+false,/i);
  });

  it("keeps the table server-owned behind RLS and service-role access", () => {
    expect(migration).toContain(
      "alter table public.timetable_public_settings enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.timetable_public_settings from anon, authenticated",
    );
    expect(migration).toContain(
      "grant all on table public.timetable_public_settings to service_role",
    );
    expect(migration).not.toMatch(/create policy/i);
  });
});
