import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0008_first_party_analytics.sql",
  "utf8",
);

describe("first-party analytics migration", () => {
  it("creates rebrand-safe anonymous event storage", () => {
    expect(migration).toContain("create table if not exists analytics_events");
    expect(migration).toContain("product_key text not null");
    expect(migration).toContain("anonymous_id uuid not null");
    expect(migration).toContain("session_id uuid not null");
    expect(migration).not.toContain("user_agent text");
    expect(migration).not.toContain("ip_address");
  });

  it("aggregates calendar feed activity without storing bearer feed tokens", () => {
    expect(migration).toContain(
      "create table if not exists calendar_feed_activity_daily",
    );
    expect(migration).toContain("record_calendar_feed_activity");
    expect(migration).toContain("request_count");
    expect(migration).toContain("not_modified_count");
    expect(migration).not.toContain("raw_token");
  });

  it("keeps analytics tables private from browser database roles", () => {
    expect(migration).toContain("alter table analytics_events enable row level security;");
    expect(migration).toContain(
      "revoke all on table analytics_events from anon, authenticated;",
    );
    expect(migration).toContain(
      "alter table calendar_feed_activity_daily enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table calendar_feed_activity_daily from anon, authenticated;",
    );
  });
});
