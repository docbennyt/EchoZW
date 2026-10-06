import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0019_growth_capture.sql",
  "utf8",
).toLowerCase();
const acquisitionSql = readFileSync(
  "supabase/migrations/0033_acquisition_request_queue.sql",
  "utf8",
).toLowerCase();

describe("growth capture migration", () => {
  it("creates private timetable request and feedback tables", () => {
    expect(sql).toContain(
      "create table if not exists public.timetable_requests",
    );
    expect(sql).toContain("create table if not exists public.product_feedback");
    expect(sql).toContain(
      "alter table public.timetable_requests enable row level security",
    );
    expect(sql).toContain(
      "alter table public.product_feedback enable row level security",
    );
  });

  it("does not expose capture tables directly to browser roles", () => {
    expect(sql).toContain(
      "revoke all on public.timetable_requests from anon, authenticated",
    );
    expect(sql).toContain(
      "revoke all on public.product_feedback from anon, authenticated",
    );
    expect(sql).toContain(
      "grant all on public.timetable_requests to service_role",
    );
    expect(sql).toContain(
      "grant all on public.product_feedback to service_role",
    );
  });

  it("requires explicit testimonial permission and founder approval separately", () => {
    expect(sql).toContain(
      "testimonial_permission boolean not null default false",
    );
    expect(sql).toContain(
      "testimonial_approved boolean not null default false",
    );
  });

  it("upgrades timetable requests into a deduplicated acquisition queue", () => {
    expect(acquisitionSql).toContain("add column if not exists demand_key");
    expect(acquisitionSql).toContain(
      "add column if not exists class_rep_status",
    );
    expect(acquisitionSql).toContain(
      "add column if not exists requester_notify_on_publish",
    );
    expect(acquisitionSql).toContain(
      "create or replace view public.timetable_acquisition_queue",
    );
    expect(acquisitionSql).toContain("count(*)::integer as request_count");
    expect(acquisitionSql).toContain(
      "count(*) filter (where email is not null and requester_notify_on_publish)::integer as notify_email_count",
    );
    expect(acquisitionSql).toContain("group by demand_key");
  });
});
