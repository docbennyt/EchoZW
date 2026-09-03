import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0017_source_gateway_auto_drafts.sql",
  "utf8",
);

describe("source gateway auto draft migration", () => {
  it("adds dynamic parser and relay secret configuration without storing secrets", () => {
    expect(migration).toContain("parser_profile text");
    expect(migration).toContain("relay_secret_env_name text");
    expect(migration).toContain("'HIT_TIMETABLE_RELAY_SECRET'");
    expect(migration).not.toContain("relay_secret text");
  });

  it("creates private job, discovery, and review tables", () => {
    expect(migration).toContain("timetable_source_processing_jobs");
    expect(migration).toContain("timetable_source_discovered_programmes");
    expect(migration).toContain("timetable_source_discovered_cohorts");
    expect(migration).toContain("timetable_source_reviews");
    expect(migration).toContain(
      "revoke all on table public.timetable_source_reviews from anon, authenticated;",
    );
  });

  it("claims worker jobs atomically with skip locked and service-role RPC grants", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain(
      "grant execute on function public.claim_timetable_source_processing_job() to service_role;",
    );
  });

  it("materializes drafts without publishing timetable versions", () => {
    expect(migration).toContain("materialize_source_generated_draft");
    expect(migration).toContain("'draft'");
    expect(migration).not.toContain("current_published_version_id =");
    expect(migration).not.toContain("publish_timetable_version");
  });
});
