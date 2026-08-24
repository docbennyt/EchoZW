import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0003_secure_admin_auth.sql",
  "utf8",
);

describe("admin_users migration", () => {
  it("creates the canonical admin authorization table", () => {
    expect(migration).toContain(
      "create table if not exists public.admin_users",
    );
    expect(migration).toContain(
      "user_id uuid primary key references auth.users(id) on delete cascade",
    );
    expect(migration).toContain("active boolean not null default true");
    expect(migration).toContain("created_by uuid references auth.users(id)");
  });

  it("enables RLS and does not grant browser roles access", () => {
    expect(migration).toContain(
      "alter table public.admin_users enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.admin_users from anon",
    );
    expect(migration).toContain(
      "revoke all on table public.admin_users from authenticated",
    );
    expect(migration).not.toMatch(/create policy/i);
  });
});
