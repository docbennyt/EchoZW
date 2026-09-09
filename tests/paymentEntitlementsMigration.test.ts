import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0024_payment_entitlements.sql",
  "utf8",
);

describe("payment entitlement migration", () => {
  it("keeps purchases, entitlements and callback evidence server-only", () => {
    for (const table of [
      "payment_purchases",
      "semester_entitlements",
      "payment_gateway_events",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(migration).toContain(
        `revoke all on table public.${table} from anon, authenticated;`,
      );
      expect(migration).toContain(
        `grant all on table public.${table} to service_role;`,
      );
    }
    expect(migration).not.toMatch(
      /card_number|cvv|cvc|mobile_money_number|raw_callback/i,
    );
  });

  it("makes checkout and callback processing idempotent", () => {
    expect(migration).toContain("idempotency_key uuid not null unique");
    expect(migration).toContain(
      "payment_purchases_active_semester_checkout_idx",
    );
    expect(migration).toContain("event_fingerprint text not null unique");
    expect(migration).toContain(
      "create or replace function public.begin_payment_purchase",
    );
    expect(migration).toContain(
      "create or replace function public.apply_verified_payment",
    );
  });

  it("supports durable pilot and paid semester entitlements without collecting contact PII", () => {
    expect(migration).toContain("'pilot_grant', 'purchase', 'manual_grant'");
    expect(migration).toContain("ensure_calendar_subscription_profile");
    expect(migration).toContain(
      "insert into public.subscriber_profiles (consent_updates)",
    );
    expect(migration).toContain("values (false)");
  });
});
