import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

describe("DR-46 web push migrations", () => {
  it("keeps endpoint capability material service-role private", () => {
    const sql = migration("0026_web_push_outbox.sql");
    expect(sql).toContain(
      "create table if not exists public.push_subscriptions",
    );
    expect(sql).toContain("endpoint_hash text not null");
    expect(sql).toContain("p256dh text not null");
    expect(sql).toContain("auth_secret text not null");
    expect(sql).toContain(
      "revoke all on table public.push_subscriptions from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant all on table public.push_subscriptions to service_role",
    );
    expect(sql).toContain(
      "alter table public.push_subscriptions enable row level security",
    );
  });

  it("enqueues student-visible truth changes transactionally", () => {
    const sql = migration("0026_web_push_outbox.sql");
    expect(sql).toContain("timetable_source_publications_push_outbox");
    expect(sql).toContain("timetable_correction_directives_push_outbox");
    expect(sql).toContain("timetable_session_exceptions_push_outbox");
    expect(sql).toContain("academic_schedule_pauses_push_outbox");
    expect(sql).toContain("on conflict (dedupe_key) do nothing");
  });

  it("snapshots targets and persists per-device retry state", () => {
    const sql = migration("0027_web_push_delivery_idempotency.sql");
    expect(sql).toContain(
      "create table if not exists public.push_notification_deliveries",
    );
    expect(sql).toContain("unique (outbox_id, subscription_id)");
    expect(sql).toContain("claim_push_notification_deliveries");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("d.locked_at < now() - interval '2 minutes'");
    expect(sql).toContain("v_delivery.attempt_count >= 6");
    expect(sql).toContain("when coalesce(p_attempt_count, 1) <= 1 then 30");
    expect(sql).toContain("when p_attempt_count = 2 then 120");
    expect(sql).toContain("when p_attempt_count = 3 then 480");
    expect(sql).toContain("else 1800");
    expect(sql).toContain("least(p_retry_after_seconds, 3600)");
  });

  it("does not expand a deduplicated old event to later subscribers", () => {
    const sql = migration("0027_web_push_delivery_idempotency.sql");
    expect(sql).toContain("returning id into v_outbox_id");
    expect(sql).toContain("if v_outbox_id is null then");
    expect(sql).toContain(
      "v_target_count := public.materialize_push_notification_targets(v_outbox_id)",
    );
  });

  it("pins helper search paths and terminalizes revoked consent", () => {
    const security = migration("0028_web_push_security_hardening.sql");
    const consent = migration("0029_web_push_consent_cleanup.sql");
    expect(security).toContain(
      "alter function public.push_retry_delay_seconds(integer, integer)",
    );
    expect(security).toContain("set search_path = public");
    expect(consent).toContain("terminalize_inactive_push_deliveries");
    expect(consent).toContain("status in ('pending', 'processing')");
    expect(consent).toContain("PUSH_SUBSCRIPTION_REVOKED");
  });
});
