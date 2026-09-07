import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0020_guarded_source_publication.sql",
  "utf8",
);

describe("guarded source publication migration", () => {
  it("persists exact verified reconciliation and publication plan evidence privately", () => {
    expect(migration).toContain(
      "create table if not exists public.timetable_source_reconciliations",
    );
    expect(migration).toContain(
      "create table if not exists public.timetable_source_publications",
    );
    expect(migration).toContain(
      "unique (\n    source_snapshot_id,\n    parse_run_id,\n    timetable_id,\n    published_version_id,\n    source_cohort_code\n  )",
    );
    expect(migration).toContain("reconciliation_id uuid not null unique");
    expect(migration).toContain("plan_hash text not null");
    expect(migration).toContain("result_hash text not null");
    expect(migration).toContain(
      "revoke all on table public.timetable_source_reconciliations from anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke all on table public.timetable_source_publications from anon, authenticated;",
    );
  });

  it("adds inspectable source/reconciliation/previous-version provenance to versions", () => {
    expect(migration).toContain("source_snapshot_id uuid references");
    expect(migration).toContain("source_parse_run_id uuid references");
    expect(migration).toContain("source_reconciliation_id uuid references");
    expect(migration).toContain(
      "previous_published_version_id uuid references",
    );
    expect(migration).toContain("publication_plan_hash text");
    expect(migration).toContain("publication_mode text");
  });

  it("publishes through one transaction after locking the exact publication, reconciliation and timetable", () => {
    expect(migration).toContain(
      "create or replace function public.publish_guarded_source_reconciliation",
    );
    expect(migration).toContain("from public.timetable_source_publications sp");
    expect(migration).toContain(
      "from public.timetable_source_reconciliations sr",
    );
    expect(migration).toContain("from public.timetables t");
    expect(
      (migration.match(/for update;/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("SOURCE_PUBLICATION_STALE_BASE");
    expect(migration).toContain("SOURCE_PUBLICATION_PLAN_HASH_MISMATCH");
    expect(migration).toContain("SOURCE_PUBLICATION_PLAN_INPUT_MISMATCH");
  });

  it("requires exact explicit approval for current-only removals", () => {
    expect(migration).toContain("SOURCE_PUBLICATION_REMOVAL_APPROVAL_REQUIRED");
    expect(migration).toContain("v_plan->'removalSessionIds'");
    expect(migration).toContain("p_approved_removal_session_ids");
    expect(migration).toContain("Extra or missing approvals fail");
  });

  it("validates the complete session set before changing the published pointer", () => {
    const validationPosition = migration.indexOf(
      "SOURCE_PUBLICATION_SESSION_INVALID",
    );
    const duplicatePosition = migration.indexOf(
      "SOURCE_PUBLICATION_DUPLICATE_STABLE_KEY",
    );
    const conflictPosition = migration.indexOf("TIMETABLE_CONFLICT");
    const pointerPosition = migration.indexOf(
      "current_published_version_id = v_version_id",
    );

    expect(validationPosition).toBeGreaterThan(0);
    expect(duplicatePosition).toBeGreaterThan(validationPosition);
    expect(conflictPosition).toBeGreaterThan(duplicatePosition);
    expect(pointerPosition).toBeGreaterThan(conflictPosition);
    expect(migration).toContain("endTime')::time <=");
    expect(migration).toContain("group by session_row->>'stableSessionKey'");
  });

  it("preserves idempotency by returning the already-published version before stale-base checks", () => {
    const replayPosition = migration.indexOf(
      "if v_publication.status = 'published' then",
    );
    const stalePosition = migration.indexOf("SOURCE_PUBLICATION_STALE_BASE");
    expect(replayPosition).toBeGreaterThan(0);
    expect(stalePosition).toBeGreaterThan(replayPosition);
    expect(migration).toContain("true\n    from public.timetables t");
  });

  it("records complete publication audit evidence", () => {
    expect(migration).toContain("'source_reconciliation.published'");
    expect(migration).toContain("'publicationId'");
    expect(migration).toContain("'planHash'");
    expect(migration).toContain("'reconciliationId'");
    expect(migration).toContain("'sourceSnapshotId'");
    expect(migration).toContain("'parseRunId'");
    expect(migration).toContain("'previousPublishedVersionId'");
    expect(migration).toContain("'approvedRemovalSessionIds'");
  });

  it("keeps the guarded function private to service_role", () => {
    expect(migration).toContain(
      "revoke execute on function public.publish_guarded_source_reconciliation(uuid, text, uuid, jsonb)\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.publish_guarded_source_reconciliation(uuid, text, uuid, jsonb)\n  to service_role;",
    );
  });
});
