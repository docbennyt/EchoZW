import type { SourceReconciliationResult } from "./sourceReconciliation.js";
import {
  buildSourcePublicationPlan,
  hashCanonicalJson,
  sourcePublicationPlanPayload,
  type PersistedVerifiedReconciliation,
  type SourcePublicationPlan,
} from "./sourcePublication.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export class SourcePublicationRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function client(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

function requireUuidLike(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_PUBLICATION_EVIDENCE_INVALID",
      `Persisted reconciliation is missing ${field}.`,
      409,
    );
  }
  return normalized;
}

export async function loadVerifiedSourceReconciliation(
  reconciliationId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedVerifiedReconciliation> {
  const { data, error } = await client(env)
    .from("timetable_source_reconciliations")
    .select(
      "id, parse_run_id, parser_version, result_hash, result_payload, status, verified_at, source_snapshot_id, timetable_id, published_version_id",
    )
    .eq("id", reconciliationId)
    .maybeSingle();

  if (error) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_PUBLICATION_DATABASE_UNAVAILABLE",
      "Could not load verified reconciliation evidence.",
      503,
      error,
    );
  }
  if (!data) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_RECONCILIATION_NOT_FOUND",
      "Verified reconciliation not found.",
      404,
    );
  }

  const row = data as unknown as JsonRecord;
  if (row.status !== "verified" && row.status !== "published") {
    throw new SourcePublicationRepositoryError(
      "SOURCE_RECONCILIATION_NOT_VERIFIED",
      "Only a verified reconciliation can be planned for publication.",
      409,
    );
  }

  const result = row.result_payload as unknown as SourceReconciliationResult;
  const resultHash = String(row.result_hash);
  if (hashCanonicalJson(result) !== resultHash) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_RECONCILIATION_EVIDENCE_HASH_MISMATCH",
      "Persisted reconciliation evidence failed its integrity hash check.",
      409,
    );
  }

  const parseRunId = requireUuidLike(row.parse_run_id, "parse run id");
  const sourceSnapshotId = requireUuidLike(
    row.source_snapshot_id,
    "source snapshot id",
  );
  const timetableId = requireUuidLike(row.timetable_id, "timetable id");
  const publishedVersionId = requireUuidLike(
    row.published_version_id,
    "published version id",
  );
  if (
    result.sourceSnapshotId !== sourceSnapshotId ||
    result.timetableId !== timetableId ||
    result.publishedVersionId !== publishedVersionId
  ) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_RECONCILIATION_EVIDENCE_MISMATCH",
      "Persisted reconciliation references do not match its immutable result payload.",
      409,
    );
  }

  return {
    id: String(row.id),
    parseRunId,
    parserVersion: String(row.parser_version),
    result,
    resultHash,
    verifiedAt: String(row.verified_at),
  };
}

export async function persistSourcePublicationPlan(
  plan: SourcePublicationPlan,
  env: NodeJS.ProcessEnv = process.env,
) {
  const supabase = client(env);
  const { data: existing, error: lookupError } = await supabase
    .from("timetable_source_publications")
    .select(
      "id, reconciliation_id, plan_hash, status, published_version_id, created_at, published_at",
    )
    .eq("reconciliation_id", plan.reconciliationId)
    .maybeSingle();

  if (lookupError) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_PUBLICATION_DATABASE_UNAVAILABLE",
      "Could not check an existing guarded publication plan.",
      503,
      lookupError,
    );
  }

  if (existing) {
    const row = existing as unknown as JsonRecord;
    if (String(row.plan_hash) !== plan.planHash) {
      throw new SourcePublicationRepositoryError(
        "SOURCE_PUBLICATION_PLAN_DRIFT",
        "The same verified reconciliation produced a different publication plan. Human review is required.",
        409,
      );
    }
    return {
      id: String(row.id),
      persistence: "existing" as const,
      plan,
      publishedAt: row.published_at ? String(row.published_at) : null,
      publishedVersionId: row.published_version_id
        ? String(row.published_version_id)
        : null,
      status: String(row.status),
    };
  }

  const status = plan.blockers.length > 0 ? "blocked" : "planned";
  const { data, error } = await supabase
    .from("timetable_source_publications")
    .insert({
      plan_hash: plan.planHash,
      plan_payload: sourcePublicationPlanPayload(plan),
      previous_published_version_id: plan.previousPublishedVersionId,
      publication_mode: "canary_manual",
      reconciliation_id: plan.reconciliationId,
      status,
      timetable_id: plan.timetableId,
    })
    .select("id, status, published_version_id, created_at, published_at")
    .single();

  if (error || !data) {
    if ((error as SupabaseErrorLike | null)?.code === "23505") {
      throw new SourcePublicationRepositoryError(
        "SOURCE_PUBLICATION_CONCURRENT_PLAN",
        "The publication plan was created concurrently. Re-run plan to inspect the persisted artifact.",
        409,
      );
    }
    throw new SourcePublicationRepositoryError(
      "SOURCE_PUBLICATION_DATABASE_UNAVAILABLE",
      "Could not persist the guarded publication plan.",
      503,
      error,
    );
  }

  const row = data as unknown as JsonRecord;
  return {
    id: String(row.id),
    persistence: "created" as const,
    plan,
    publishedAt: row.published_at ? String(row.published_at) : null,
    publishedVersionId: row.published_version_id
      ? String(row.published_version_id)
      : null,
    status: String(row.status),
  };
}

export async function createGuardedSourcePublicationPlan(
  reconciliationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const reconciliation = await loadVerifiedSourceReconciliation(
    reconciliationId,
    env,
  );
  const plan = buildSourcePublicationPlan(reconciliation);
  return persistSourcePublicationPlan(plan, env);
}

export async function executeGuardedSourcePublication(
  input: {
    actorId: string;
    approvedRemovalSessionIds: string[];
    expectedPlanHash: string;
    publicationId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env).rpc(
    "publish_guarded_source_reconciliation",
    {
      p_approved_removal_session_ids: input.approvedRemovalSessionIds,
      p_expected_plan_hash: input.expectedPlanHash,
      p_publication_id: input.publicationId,
      p_published_by: input.actorId,
    },
  );

  if (error) {
    const message = String((error as SupabaseErrorLike).message ?? "");
    const knownCode = [
      "SOURCE_PUBLICATION_ACTOR_REQUIRED",
      "SOURCE_PUBLICATION_BLOCKED",
      "SOURCE_PUBLICATION_PLAN_HASH_MISMATCH",
      "SOURCE_PUBLICATION_PLAN_HAS_BLOCKERS",
      "SOURCE_PUBLICATION_PLAN_INPUT_MISMATCH",
      "SOURCE_PUBLICATION_RECONCILIATION_MISMATCH",
      "SOURCE_PUBLICATION_REMOVAL_APPROVAL_REQUIRED",
      "SOURCE_PUBLICATION_SESSION_INVALID",
      "SOURCE_PUBLICATION_STALE_BASE",
      "SOURCE_RECONCILIATION_NOT_VERIFIED",
      "TIMETABLE_CONFLICT",
      "TIMETABLE_EMPTY",
    ].find((code) => message.includes(code));
    throw new SourcePublicationRepositoryError(
      knownCode ?? "SOURCE_PUBLICATION_FAILED",
      knownCode
        ? `Guarded source publication stopped safely: ${knownCode}.`
        : "Guarded source publication failed before completion.",
      knownCode ? 409 : 503,
      error,
    );
  }

  const record = Array.isArray(data) ? data[0] : data;
  if (!record) {
    throw new SourcePublicationRepositoryError(
      "SOURCE_PUBLICATION_RESULT_MISSING",
      "Guarded source publication returned no result.",
      503,
    );
  }
  const row = record as unknown as JsonRecord;
  return {
    idempotentReplay: Boolean(row.idempotent_replay),
    publicationId: String(row.publication_id),
    publicSlug: String(row.public_slug),
    publishedAt: String(row.published_at),
    sessionCount: Number(row.session_count),
    versionId: String(row.version_id),
    versionNumber: Number(row.version_number),
  };
}
