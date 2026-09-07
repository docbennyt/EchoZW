import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0021_correction_idempotency_and_safe_crud.sql",
  "utf8",
);

describe("DR-53 correction mutation hardening migration", () => {
  it("persists request idempotency at timetable + staff actor scope", () => {
    expect(migration).toContain("add column if not exists mutation_key uuid");
    expect(migration).toContain("timetable_correction_mutation_key_unique_idx");
    expect(migration).toContain("timetable_exception_mutation_key_unique_idx");
    expect(migration).toMatch(
      /\(timetable_id, creator_staff_user_id, mutation_key\)/,
    );
  });

  it("guards exact active semantic duplicates under a database transaction lock", () => {
    expect(migration).toContain("timetable_correction_semantic_fingerprint");
    expect(migration).toContain("timetable_exception_semantic_fingerprint");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("TIMETABLE_UPDATE_ALREADY_EXISTS");
    expect(migration).toContain("timetable_correction_semantic_duplicate_guard");
    expect(migration).toContain("timetable_exception_semantic_duplicate_guard");
  });

  it("backfills fingerprints without destructively cleaning historic duplicates", () => {
    expect(migration).toContain("Backfill exact semantic identities");
    expect(migration).toMatch(
      /update public\.timetable_correction_directives[\s\S]*semantic_fingerprint/,
    );
    expect(migration).toMatch(
      /update public\.timetable_session_exceptions[\s\S]*semantic_fingerprint/,
    );
    expect(migration).not.toMatch(
      /delete\s+from\s+public\.(?:timetable_correction_directives|timetable_session_exceptions)/i,
    );
  });

  it("uses revision-checked supersession rather than overwriting history", () => {
    expect(migration).toContain("replace_timetable_correction_update");
    expect(migration).toContain("replace_timetable_exception_update");
    expect(migration).toContain("CORRECTION_STALE_EDIT");
    expect(migration).toContain("EXCEPTION_STALE_EDIT");
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain("replaced_by_id");
    expect(migration).toContain("for update");
  });

  it("deduplicates an exact group deterministically by soft revocation", () => {
    expect(migration).toContain("dedupe_timetable_correction_group");
    expect(migration).toContain("dedupe_timetable_exception_group");
    expect(migration).toContain("order by created_at asc, id asc");
    expect(migration).toContain("set active = false");
    expect(migration).toContain("revoked_at = now()");
  });

  it("keeps privileged correction RPCs service-role only", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain(
      "revoke execute on function public.replace_timetable_correction_update",
    );
    expect(migration).toContain(
      "revoke execute on function public.dedupe_timetable_correction_group",
    );
  });
});
