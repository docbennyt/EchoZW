import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type { HitSnapshotParserInput } from "../src/domain/hitMasterSnapshotParser.js";
import type { GoogleDocsSourceSnapshot } from "../src/domain/sourceSnapshots.js";
import type { SourceParserResult } from "./sourceParserRegistry.js";
import { SourceSnapshotRepositoryError } from "./sourceSnapshotRepository.js";

type JsonRecord = Record<string, unknown>;
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type QueryResult<T> = { data: T | null; error: SupabaseErrorLike | null };
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type RelaySnapshotForParse = HitSnapshotParserInput & {
  acceptedAt: string;
  externalFileId: string;
  observedAt: string;
  processingStatus: "parse_failed" | "parsed" | "pending_parse";
  provider: string;
  snapshotId: string;
  sourceId: string;
  parserProfile: string | null;
};

export type SourceSnapshotParseRunRecord = {
  completedAt: string | null;
  failureCode: string | null;
  failureMetadata: Record<string, unknown>;
  id: string;
  parserVersion: string;
  resultPayload: Record<string, unknown>;
  snapshotId: string;
  startedAt: string;
  status: "failed" | "parsed" | "review_required";
  summary: Record<string, unknown>;
};

function createSourceSnapshotClient(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

async function expectData<T>(
  query: PromiseLike<QueryResult<T>>,
  message: string,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      message,
      error,
    );
  }
  return data;
}

function mapParseRun(row: JsonRecord): SourceSnapshotParseRunRecord {
  return {
    completedAt: row.completed_at ? String(row.completed_at) : null,
    failureCode: row.failure_code ? String(row.failure_code) : null,
    failureMetadata: ((row.failure_metadata as JsonRecord | null) ??
      {}) as Record<string, unknown>,
    id: String(row.id),
    parserVersion: String(row.parser_version),
    resultPayload: ((row.result_payload as JsonRecord | null) ?? {}) as Record<
      string,
      unknown
    >,
    snapshotId: String(row.snapshot_id),
    startedAt: String(row.started_at),
    status: String(row.status) as SourceSnapshotParseRunRecord["status"],
    summary: ((row.summary as JsonRecord | null) ?? {}) as Record<
      string,
      unknown
    >,
  };
}

function isPlainJsonObject(value: unknown): value is Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (isPlainJsonObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, JsonValue>>((result, key) => {
        result[key] = canonicalizeJsonValue(value[key]);
        return result;
      }, {});
  }

  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export async function loadLatestRelaySnapshotForParsing(
  sourceKey: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const source = await expectData(
    client
      .from("timetable_sources")
      .select("id, source_key, provider, external_file_id, parser_profile")
      .eq("source_key", sourceKey)
      .single(),
    "Could not load the configured relay source for parsing.",
  );
  if (!source) return null;

  const snapshot = await expectData(
    client
      .from("timetable_source_snapshots")
      .select(
        "id, source_id, provider, external_file_id, observed_at, accepted_at, content_hash, raw_payload, processing_status",
      )
      .eq("source_id", String((source as JsonRecord).id))
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Could not load the latest relay source snapshot for parsing.",
  );
  if (!snapshot) return null;

  return {
    acceptedAt: String((snapshot as JsonRecord).accepted_at),
    contentHash: String((snapshot as JsonRecord).content_hash),
    externalFileId: String((snapshot as JsonRecord).external_file_id),
    observedAt: String((snapshot as JsonRecord).observed_at),
    payload: ((snapshot as JsonRecord).raw_payload ??
      {}) as GoogleDocsSourceSnapshot,
    processingStatus: String(
      (snapshot as JsonRecord).processing_status,
    ) as RelaySnapshotForParse["processingStatus"],
    provider: String((snapshot as JsonRecord).provider),
    snapshotId: String((snapshot as JsonRecord).id),
    sourceId: String((snapshot as JsonRecord).source_id),
    sourceKey: String((source as JsonRecord).source_key),
    parserProfile: (source as JsonRecord).parser_profile
      ? String((source as JsonRecord).parser_profile)
      : null,
  } satisfies RelaySnapshotForParse;
}

async function updateSnapshotParseState(
  snapshotId: string,
  patch: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const { error } = await client
    .from("timetable_source_snapshots")
    .update(patch)
    .eq("id", snapshotId);

  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not update the source snapshot parsing status.",
      error,
    );
  }
}

async function loadExistingParseRun(
  snapshotId: string,
  parserVersion: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const data = await expectData(
    client
      .from("timetable_source_parse_runs")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .eq("parser_version", parserVersion)
      .maybeSingle(),
    "Could not load the existing source snapshot parse run.",
  );

  return data ? mapParseRun(data as unknown as JsonRecord) : null;
}

export async function persistSourceSnapshotParseRun(
  input: {
    parserResult: SourceParserResult;
    snapshot: RelaySnapshotForParse;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const completedAt = new Date().toISOString();
  const insertPayload = {
    completed_at: completedAt,
    failure_code: null,
    failure_metadata: {},
    parser_version: input.parserResult.parserVersion,
    result_payload: input.parserResult,
    snapshot_id: input.snapshot.snapshotId,
    started_at: completedAt,
    status: input.parserResult.status,
    summary: input.parserResult.summary,
  };

  const { data, error } = await client
    .from("timetable_source_parse_runs")
    .insert(insertPayload)
    .select("*")
    .single();

  let persistence: "created" | "existing" = "created";
  let parseRun: SourceSnapshotParseRunRecord;

  if (error?.code === "23505") {
    const existing = await loadExistingParseRun(
      input.snapshot.snapshotId,
      input.parserResult.parserVersion,
      env,
    );
    if (!existing) {
      throw new SourceSnapshotRepositoryError(
        "SOURCE_DATABASE_UNAVAILABLE",
        503,
        "The source parse run already exists but could not be loaded.",
        error,
      );
    }

    const sameResult =
      canonicalJsonString(existing.resultPayload) ===
        canonicalJsonString(input.parserResult) &&
      canonicalJsonString(existing.summary) ===
        canonicalJsonString(input.parserResult.summary) &&
      existing.status === input.parserResult.status;
    if (!sameResult) {
      throw new SourceSnapshotRepositoryError(
        "SOURCE_PARSE_VERSION_CONFLICT",
        409,
        "The existing parse run for this snapshot and parser version does not match the current parser output.",
      );
    }

    persistence = "existing";
    parseRun = existing;
  } else if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not store the source snapshot parse run.",
      error,
    );
  } else {
    parseRun = mapParseRun(data as unknown as JsonRecord);
  }

  await updateSnapshotParseState(
    input.snapshot.snapshotId,
    {
      failure_code: null,
      failure_metadata: {},
      processing_status: "parsed",
    },
    env,
  );

  return {
    parseRun,
    persistence,
  };
}

export async function persistSourceSnapshotParseFailure(
  input: {
    failureCode: string;
    failureMetadata: Record<string, unknown>;
    parserVersion: string;
    snapshot: RelaySnapshotForParse;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const completedAt = new Date().toISOString();
  const insertPayload = {
    completed_at: completedAt,
    failure_code: input.failureCode,
    failure_metadata: input.failureMetadata,
    parser_version: input.parserVersion,
    result_payload: {},
    snapshot_id: input.snapshot.snapshotId,
    started_at: completedAt,
    status: "failed",
    summary: {},
  };

  const { error } = await client
    .from("timetable_source_parse_runs")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error?.code && error.code !== "23505") {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not store the source snapshot parse failure record.",
      error,
    );
  }

  await updateSnapshotParseState(
    input.snapshot.snapshotId,
    {
      failure_code: input.failureCode,
      failure_metadata: input.failureMetadata,
      processing_status: "parse_failed",
    },
    env,
  );
}
