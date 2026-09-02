import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0013_founder_analytics_command_center.sql",
  "utf8",
);

describe("founder analytics command center migration", () => {
  it("uses the next migration number after applied Google direct sync", () => {
    expect(migration).toContain("Founder analytics command center foundation");
    expect(() =>
      readFileSync(
        "supabase/migrations/0012_founder_analytics_command_center.sql",
        "utf8",
      ),
    ).toThrow();
  });

  it("creates deterministic analytics identity tables without heuristic merge inputs", () => {
    expect(migration).toContain(
      "create table if not exists public.analytics_people",
    );
    expect(migration).toContain(
      "create table if not exists public.analytics_person_identities",
    );
    expect(migration).toContain("'anonymous_id'");
    expect(migration).toContain("'subscription_id'");
    expect(migration).toContain("'subscriber_profile_id'");
    expect(migration).not.toContain("ip_address");
    expect(migration).not.toContain("user_agent");
    expect(migration).not.toContain("fingerprint");
  });

  it("lets deterministic subscription identity dominate anonymous browser identity", () => {
    expect(
      migration.indexOf("where identity_type = 'subscription_id'"),
    ).toBeLessThan(migration.indexOf("where identity_type = 'anonymous_id'"));
    expect(migration).toContain(
      "when p_subscription_id is not null then 'subscription_linked'",
    );
  });

  it("keeps high-write event ingestion free of database triggers", () => {
    expect(migration).not.toContain("create trigger");
    expect(migration).not.toContain("before insert on public.analytics_events");
    expect(migration).toContain("resolve_analytics_person");
    expect(migration).toContain(
      "grant execute on function public.resolve_analytics_person",
    );
  });

  it("surfaces Google connection state through the subscription relationship", () => {
    expect(migration).toContain(
      "left join public.google_calendar_credentials gc",
    );
    expect(migration).toContain(
      "bool_or(gc.subscription_id is not null) as has_google_connection",
    );
  });

  it("keeps founder analytics private from browser database roles", () => {
    expect(migration).toContain(
      "alter table public.analytics_people enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.analytics_people from anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke all on table public.analytics_person_identities from anon, authenticated;",
    );
    expect(migration).toContain(
      "grant all on table public.analytics_people to service_role;",
    );
  });

  it("excludes one-time ICS downloads from active calendar connection counts", () => {
    expect(migration).toContain("cs.provider <> 'ics_download'");
    expect(migration).toContain("'ics_download_completed'");
  });

  it("defines explainable stage and score SQL functions", () => {
    expect(migration).toContain("analytics_stage_for_events");
    expect(migration).toContain("analytics_score_for_events");
    expect(migration).toContain("'At risk'");
    expect(migration).toContain("'Active subscriber'");
  });

  it("defines first-slice overview metrics and data quality outputs", () => {
    expect(migration).toContain("new_calendar_connections integer");
    expect(migration).toContain("adoption_timeseries jsonb");
    expect(migration).toContain("unique_anonymous_identities integer");
    expect(migration).toContain("identities_stitched_to_subscriptions integer");
    expect(migration).toContain("consented_contact_linkage_rate numeric");
    expect(migration).toContain("known_historical_instrumentation_gaps text[]");
  });

  it("counts funnel stages by unique analytical people across equivalent events", () => {
    expect(migration).toContain("count(distinct pe.person_key)::integer");
    expect(migration).toContain("'Calendar connection created'");
    expect(migration).toContain("'google_oauth_completed'");
    expect(migration).toContain("'calendar_subscription_created'");
  });
});
