import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0009_staff_roles_and_class_rep_assignments.sql",
  "utf8",
);

describe("staff authorization migration", () => {
  it("creates staff users with explicit CalenderZW roles", () => {
    expect(migration).toContain(
      "create table if not exists public.staff_users",
    );
    expect(migration).toContain(
      "user_id uuid not null unique references auth.users(id) on delete cascade",
    );
    expect(migration).toContain(
      "role text not null check (role in ('superadmin', 'class_rep'))",
    );
    expect(migration).toContain("active boolean not null default true");
    expect(migration).toContain("created_by uuid references auth.users(id)");
  });

  it("creates timetable-scoped class rep assignments", () => {
    expect(migration).toContain(
      "create table if not exists public.class_rep_assignments",
    );
    expect(migration).toContain(
      "staff_user_id uuid not null references public.staff_users(id) on delete cascade",
    );
    expect(migration).toContain(
      "timetable_id uuid not null references public.timetables(id) on delete cascade",
    );
    expect(migration).toContain(
      "create unique index if not exists class_rep_assignments_one_active_idx",
    );
    expect(migration).toContain("where active");
  });

  it("keeps staff authorization server-side only", () => {
    expect(migration).toContain(
      "alter table public.staff_users enable row level security",
    );
    expect(migration).toContain(
      "alter table public.class_rep_assignments enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.staff_users from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on table public.class_rep_assignments from anon, authenticated",
    );
    expect(migration).not.toMatch(/create policy/i);
  });

  it("only bootstraps a legacy admin as superadmin when exactly one active admin exists", () => {
    expect(migration).toContain("active_admin_count = 1");
    expect(migration).toContain("insert into public.staff_users");
    expect(migration).toContain("'superadmin'");
    expect(migration).not.toMatch(/delete from public\.admin_users/i);
    expect(migration).not.toMatch(/drop table .*admin_users/i);
  });
});
