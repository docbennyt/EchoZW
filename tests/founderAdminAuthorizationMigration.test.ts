import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0022_founder_protected_admin_role.sql",
  "utf8",
);

describe("founder-protected Admin authorization migration", () => {
  it("adds admin as a real server-owned staff role and a durable founder marker", () => {
    expect(migration).toContain(
      "check (role in ('superadmin', 'admin', 'class_rep'))",
    );
    expect(migration).toContain(
      "add column if not exists is_founder boolean not null default false",
    );
    expect(migration).toContain("staff_users_one_founder_idx");
    expect(migration).toContain("where is_founder");
    expect(migration).toContain("((role = 'superadmin') = is_founder)");
    expect(migration).toContain("check (not is_founder or active)");
  });

  it("fails safely rather than guessing when founder data is ambiguous", () => {
    expect(migration).toContain("CZWFOUNDER_AMBIGUOUS");
    expect(migration).toContain(
      "multiple superadmins require explicit operator resolution",
    );
    expect(migration).toContain(
      "multiple active legacy admins require explicit operator resolution",
    );
    expect(migration).toContain("CZWFOUNDER_MISSING");
    expect(migration).not.toMatch(/order by .*limit 1/is);
  });

  it("protects founder authority at the database boundary", () => {
    expect(migration).toContain("guard_czw_founder_authority");
    expect(migration).toContain("FOUNDER_PROTECTED");
    expect(migration).toContain("FOUNDER_ALREADY_EXISTS");
    expect(migration).toContain("FOUNDER_GRANT_FORBIDDEN");
    expect(migration).toContain(
      "before insert or update or delete on public.staff_users",
    );
  });

  it("allows admin provenance on correction overlays without weakening server-only access", () => {
    expect(migration).toContain(
      "creator_role in ('superadmin', 'admin', 'class_rep')",
    );
    expect(migration).not.toMatch(/grant .*staff_users.*authenticated/i);
    expect(migration).not.toMatch(/create policy/i);
  });
});
