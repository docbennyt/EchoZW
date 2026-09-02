import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0012_google_calendar_direct_sync.sql",
  "utf8",
);

describe("Google Calendar direct sync migration", () => {
  it("stores OAuth state server-side with expiry and subscription scope", () => {
    expect(migration).toContain(
      "create table if not exists google_calendar_oauth_states",
    );
    expect(migration).toContain("state_hash text primary key");
    expect(migration).toContain(
      "subscription_id uuid not null references calendar_subscriptions(id) on delete cascade",
    );
    expect(migration).toContain("expires_at timestamptz not null");
  });

  it("stores only encrypted long-lived Google credentials", () => {
    expect(migration).toContain(
      "create table if not exists google_calendar_credentials",
    );
    expect(migration).toContain("encrypted_refresh_token text not null");
    expect(migration).toContain("granted_scope text not null");
    expect(migration).not.toMatch(/^\s*access_token\s+text\b/m);
    expect(migration).not.toMatch(/^\s*refresh_token\s+text\b/m);
  });

  it("keeps OAuth state and credentials inaccessible to browser roles", () => {
    expect(migration).toContain(
      "alter table google_calendar_oauth_states enable row level security",
    );
    expect(migration).toContain(
      "alter table google_calendar_credentials enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table google_calendar_oauth_states from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on table google_calendar_credentials from anon, authenticated",
    );
  });
});
