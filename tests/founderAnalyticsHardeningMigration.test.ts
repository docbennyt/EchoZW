import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const identitySql = readFileSync(
  "supabase/migrations/0014_founder_analytics_correctness_hardening.sql",
  "utf8",
);

const metricSql = readFileSync(
  "supabase/migrations/0015_founder_analytics_metric_hardening.sql",
  "utf8",
);

describe("founder analytics hardening migrations", () => {
  it("preserves the strongest deterministic identity confidence", () => {
    expect(identitySql).toContain(
      "when identity_strength = 'consented_contact_linked'",
    );
    expect(identitySql).toContain("or profile_uuid is not null");
    expect(identitySql).toContain("or p_subscription_id is not null");
    expect(identitySql).toContain(
      "values (person_id, 'anonymous_id', p_anonymous_id)",
    );
  });

  it("keeps analytics helper execution private to the service role", () => {
    expect(identitySql).toContain(
      "grant execute on function public.analytics_stage_for_events",
    );
    expect(identitySql).toContain(
      "grant execute on function public.analytics_score_for_events",
    );
    expect(identitySql).toContain(
      "revoke all on function public.resolve_analytics_person",
    );
    expect(identitySql).not.toContain("to anon");
    expect(identitySql).not.toContain("to authenticated");
  });

  it("excludes one-time ICS exports from calendar activation", () => {
    expect(metricSql).toContain("'google_api'");
    expect(metricSql).toContain("'apple_subscription'");
    expect(metricSql).toContain("'webcal_subscription'");
    expect(metricSql).toContain("'outlook_subscription'");
    expect(metricSql).not.toContain("'ics_download'");
  });

  it("calculates known identity share instead of returning a fake zero", () => {
    expect(metricSql).toContain("as linked_people");
    expect(metricSql).toContain(
      "coalesce(im.linked_people::numeric / nullif(im.total_people, 0), 0)",
    );
    expect(metricSql).not.toContain("0::numeric as known_vs_anonymous_ratio");
  });

  it("keeps both aggregate implementations unavailable to browser roles", () => {
    expect(metricSql).toContain(
      "revoke all on function public.get_admin_analytics_overview_v1",
    );
    expect(metricSql).toContain(
      "revoke all on function public.get_admin_analytics_overview(",
    );
    expect(metricSql).not.toContain("to anon");
    expect(metricSql).not.toContain("to authenticated");
  });
});
