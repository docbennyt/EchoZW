import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type StaticTimetableRawCleanupResult = {
  inspected: number;
  deleted: number;
  failed: number;
  skipped: number;
  failures: Array<{ sourceDocumentId: string; code: string }>;
};

const RAW_SOURCE_BUCKET = "timetable-sources";
const RAW_CLEANUP_POLICY = "private_raw_source_cleanup";
const DEFAULT_CLEANUP_LIMIT = 25;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function rawRetention(metadata: unknown) {
  return asRecord(asRecord(metadata).rawRetention);
}

function cleanupStatus(metadata: unknown) {
  const status = rawRetention(metadata).cleanupStatus;
  return typeof status === "string" ? status : null;
}

function rawDeleteEligibleAt(metadata: unknown) {
  const value = rawRetention(metadata).rawDeleteEligibleAt;
  return typeof value === "string" ? value : null;
}

function isEligible(metadata: unknown, now: Date) {
  if (cleanupStatus(metadata) === "deleted") return false;
  const eligibleAt = rawDeleteEligibleAt(metadata);
  if (!eligibleAt) return false;
  const timestamp = Date.parse(eligibleAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function mergeRawRetention(metadata: unknown, patch: Record<string, unknown>) {
  const current = asRecord(metadata);
  return {
    ...current,
    rawRetention: {
      ...rawRetention(current),
      ...patch,
    },
  };
}

function storageMissing(error: SupabaseErrorLike | null | undefined) {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""} ${
    error.details ?? ""
  }`.toLocaleLowerCase("en");
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("404")
  );
}

export async function cleanupEligibleStaticTimetableRawSources(
  input: {
    limit?: number;
    now?: Date;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<StaticTimetableRawCleanupResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const limit = Math.max(
    1,
    Math.min(input.limit ?? DEFAULT_CLEANUP_LIMIT, 100),
  );
  const supabase = createSupabaseAdminClient(env);
  const result: StaticTimetableRawCleanupResult = {
    inspected: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  const query = await supabase
    .from("source_documents")
    .select("id,storage_path,metadata")
    .eq("document_type", "static_timetable_document")
    .eq("metadata->rawRetention->>policy", RAW_CLEANUP_POLICY)
    .lte("metadata->rawRetention->>rawDeleteEligibleAt", now.toISOString())
    .limit(limit);
  if (query.error) {
    throw new Error(
      `STATIC_IMPORT_RAW_CLEANUP_QUERY_FAILED: ${query.error.message}`,
    );
  }

  const rows = (query.data ?? []) as JsonRecord[];
  result.inspected = rows.length;

  for (const row of rows) {
    const sourceDocumentId = String(row.id ?? "");
    const storagePath = String(row.storage_path ?? "").trim();
    const metadata = asRecord(row.metadata);

    if (!sourceDocumentId || !storagePath || !isEligible(metadata, now)) {
      result.skipped += 1;
      continue;
    }

    const removed = await supabase.storage
      .from(RAW_SOURCE_BUCKET)
      .remove([storagePath]);
    const removeError = removed.error as SupabaseErrorLike | null;

    if (removeError && !storageMissing(removeError)) {
      result.failed += 1;
      result.failures.push({
        sourceDocumentId,
        code: removeError.code ?? "RAW_SOURCE_DELETE_FAILED",
      });
      await supabase
        .from("source_documents")
        .update({
          metadata: mergeRawRetention(metadata, {
            cleanupStatus: "failed",
            cleanupFailedAt: now.toISOString(),
            cleanupErrorCode: removeError.code ?? "RAW_SOURCE_DELETE_FAILED",
          }),
        })
        .eq("id", sourceDocumentId);
      continue;
    }

    const update = await supabase
      .from("source_documents")
      .update({
        metadata: mergeRawRetention(metadata, {
          cleanupStatus: "deleted",
          rawDeletedAt: now.toISOString(),
          cleanupFailedAt: null,
          cleanupErrorCode: null,
        }),
      })
      .eq("id", sourceDocumentId);
    if (update.error) {
      result.failed += 1;
      result.failures.push({
        sourceDocumentId,
        code: update.error.code ?? "RAW_SOURCE_CLEANUP_MARK_FAILED",
      });
      continue;
    }

    result.deleted += 1;
  }

  return result;
}
