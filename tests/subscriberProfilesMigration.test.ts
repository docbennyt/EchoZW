import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0011_subscriber_profiles.sql",
  "utf8",
);

describe("subscriber profiles migration", () => {
  it("creates a server-owned PII table with RLS and no browser grants", () => {
    expect(migration).toContain(
      "create table if not exists public.subscriber_profiles",
    );
    expect(migration).toContain(
      "alter table public.subscriber_profiles enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.subscriber_profiles from anon, authenticated;",
    );
    expect(migration).toContain(
      "grant all on table public.subscriber_profiles to service_role;",
    );
  });

  it("links subscriptions to profiles without breaking legacy anonymous rows", () => {
    expect(migration).toContain(
      "add column if not exists subscriber_profile_id uuid",
    );
    expect(migration).toContain(
      "references public.subscriber_profiles(id) on delete set null",
    );
  });

  it("uses one server-side transaction for profile linking and subscription creation", () => {
    expect(migration).toContain(
      "create or replace function public.create_calendar_subscription_with_profile",
    );
    expect(migration).toContain("returns public.calendar_subscriptions");
    expect(migration).toContain("grant execute on function");
    expect(migration).toContain("to service_role");
  });
});
