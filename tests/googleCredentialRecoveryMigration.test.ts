import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261029070644_legacy_google_credential_recovery.sql",
  "utf8",
);

describe("legacy Google credential recovery storage", () => {
  it("keeps an encrypted backup and compare-and-swap metadata on the existing credential", () => {
    expect(migration).toContain("legacy_encrypted_refresh_token_backup text");
    expect(migration).toContain(
      "encrypted_refresh_token = p_expected_ciphertext",
    );
    expect(migration).toContain(
      "legacy_encrypted_refresh_token_backup is null",
    );
    expect(migration).toContain("encryption_migration_id = p_migration_id");
  });

  it("records swap, verification and recoverable rollback without plaintext", () => {
    expect(migration).toContain("'swapped'");
    expect(migration).toContain("'verified'");
    expect(migration).toContain("'failed_reverted'");
    expect(migration).not.toMatch(/^\s*refresh_token\s+text\b/m);
  });

  it("keeps audit storage and migration RPCs unavailable to browser roles", () => {
    expect(migration).toContain(
      "alter table public.google_calendar_credential_migration_audit enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.google_calendar_credential_migration_audit from public, anon, authenticated",
    );
    expect(migration.match(/security invoker/g)).toHaveLength(3);
    expect(migration.match(/revoke all on function/g)).toHaveLength(3);
  });
});
