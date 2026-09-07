import type {
  ReconciliationBinding,
  SourceReconciliationResult,
} from "./sourceReconciliation.js";
import type { SourceReconciliationBindingRecord } from "./sourceReconciliationRepository.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { hashCanonicalJson } from "./sourcePublication.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type VerifiedCompareOnlyRun = SourceReconciliationResult & {
  binding: ReconciliationBinding & SourceReconciliationBindingRecord;
  parseRunId: string;
  parserVersion: string;
  zeroMutationProof: {
    noMutationsObserved: boolean;
  };
};

export class SourceReconciliationPersistenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function persistedResultPayload(
  input: VerifiedCompareOnlyRun,
): SourceReconciliationResult {
  return {
    binding: {
      sourceCohortCode: input.binding.sourceCohortCode,
      sourceKey: input.binding.sourceKey,
      targetAcademicPeriodName: input.binding.targetAcademicPeriodName,
      targetClassGroupLabel: input.binding.targetClassGroupLabel,
      targetPublicSlug: input.binding.targetPublicSlug,
    },
    cohort: input.cohort,
    invariants: input.invariants,
    items: input.items,
    publishedVersionId: input.publishedVersionId,
    sourceSnapshotId: input.sourceSnapshotId,
    summary: input.summary,
    timetableId: input.timetableId,
  };
}

export async function persistVerifiedSourceReconciliation(
  input: VerifiedCompareOnlyRun,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!input.zeroMutationProof.noMutationsObserved) {
    throw new SourceReconciliationPersistenceError(
      "SOURCE_RECONCILIATION_MUTATION_DETECTED",
      "Compare-only reconciliation changed student-visible state; refusing to persist it as verified.",
    );
  }
  if (!input.invariants.noSilentLoss) {
    throw new SourceReconciliationPersistenceError(
      "SOURCE_RECONCILIATION_INVARIANT_FAILED",
      "Reconciliation conservation invariant failed; refusing to persist it as verified.",
    );
  }
  if (!input.binding.id) {
    throw new SourceReconciliationPersistenceError(
      "SOURCE_RECONCILIATION_BINDING_ID_REQUIRED",
      "Verified reconciliation requires the exact persisted source binding id.",
    );
  }

  const resultPayload = persistedResultPayload(input);
  const resultHash = hashCanonicalJson(resultPayload);
  const client = createSupabaseAdminClient(env);
  const { data: existing, error: lookupError } = await client
    .from("timetable_source_reconciliations")
    .select("id, result_hash, status, verified_at")
    .eq("source_snapshot_id", input.sourceSnapshotId)
    .eq("parse_run_id", input.parseRunId)
    .eq("timetable_id", input.timetableId)
    .eq("published_version_id", input.publishedVersionId)
    .eq("source_cohort_code", input.cohort)
    .maybeSingle();

  if (lookupError) {
    throw new SourceReconciliationPersistenceError(
      "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
      "Could not check persisted reconciliation evidence.",
      lookupError,
    );
  }

  if (existing) {
    const row = existing as unknown as JsonRecord;
    if (String(row.result_hash) !== resultHash) {
      throw new SourceReconciliationPersistenceError(
        "SOURCE_RECONCILIATION_RESULT_DRIFT",
        "The same source/parse/published-version input produced different reconciliation evidence. Human review is required.",
      );
    }
    return {
      id: String(row.id),
      persistence: "existing" as const,
      resultHash,
      status: String(row.status),
      verifiedAt: String(row.verified_at),
    };
  }

  const verifiedAt = new Date().toISOString();
  const { data, error } = await client
    .from("timetable_source_reconciliations")
    .insert({
      binding_id: input.binding.id,
      parse_run_id: input.parseRunId,
      parser_version: input.parserVersion,
      published_version_id: input.publishedVersionId,
      result_hash: resultHash,
      result_payload: resultPayload,
      source_cohort_code: input.cohort,
      source_snapshot_id: input.sourceSnapshotId,
      status: "verified",
      timetable_id: input.timetableId,
      verification_mode: "compare_only",
      verified_at: verifiedAt,
    })
    .select("id, status, verified_at")
    .single();

  if (error || !data) {
    if ((error as SupabaseErrorLike | null)?.code === "23505") {
      throw new SourceReconciliationPersistenceError(
        "SOURCE_RECONCILIATION_CONCURRENT_PERSISTENCE",
        "The reconciliation was persisted concurrently. Re-run compare-only reconciliation to reuse the verified artifact.",
      );
    }
    throw new SourceReconciliationPersistenceError(
      "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
      "Could not persist verified reconciliation evidence.",
      error,
    );
  }

  const row = data as unknown as JsonRecord;
  return {
    id: String(row.id),
    persistence: "created" as const,
    resultHash,
    status: String(row.status),
    verifiedAt: String(row.verified_at),
  };
}
