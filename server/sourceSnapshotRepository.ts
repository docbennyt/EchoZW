import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type { GoogleDocsSourceSnapshot } from "../src/domain/sourceSnapshots.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: SupabaseErrorLike | null };
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type RelaySourceRecord = {
  id: string;
  sourceKey: string;
  displayName: string;
  provider: string;
  externalFileId: string;
  active: boolean;
  lastObservedAt: string | null;
  lastSnapshotReceivedAt: string | null;
  lastSuccessfulSnapshotAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
};

export class SourceSnapshotRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function createSourceSnapshotClient(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

function mapRelaySource(row: JsonRecord): RelaySourceRecord {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    displayName: String(row.display_name),
    provider: String(row.provider),
    externalFileId: String(row.external_file_id),
    active: Boolean(row.active),
    lastObservedAt: row.last_observed_at ? String(row.last_observed_at) : null,
    lastSnapshotReceivedAt: row.last_snapshot_received_at
      ? String(row.last_snapshot_received_at)
      : null,
    lastSuccessfulSnapshotAt: row.last_successful_snapshot_at
      ? String(row.last_successful_snapshot_at)
      : null,
    lastErrorAt: row.last_error_at ? String(row.last_error_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
  };
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

export async function getRelaySourceByKey(
  sourceKey: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const data = await expectData(
    client
      .from("timetable_sources")
      .select("*")
      .eq("source_key", sourceKey)
      .maybeSingle(),
    "Could not load the configured relay source.",
  );

  if (!data) return null;
  return mapRelaySource(data as unknown as JsonRecord);
}

async function updateRelaySourceHealth(
  sourceId: string,
  patch: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const { error } = await client
    .from("timetable_sources")
    .update(patch)
    .eq("id", sourceId);

  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not update the relay source health metadata.",
      error,
    );
  }
}

export async function markRelaySourceError(
  input: {
    sourceId: string;
    errorCode: string;
    observedAt?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    await updateRelaySourceHealth(
      input.sourceId,
      {
        last_observed_at: input.observedAt ?? null,
        last_error_at: new Date().toISOString(),
        last_error_code: input.errorCode,
      },
      env,
    );
  } catch {
    // Error tracking must not mask the primary failure path.
  }
}

export async function acceptRelaySourceSnapshot(
  input: {
    source: RelaySourceRecord;
    payload: GoogleDocsSourceSnapshot;
    contentHash: string;
    tabCount: number;
    tableCount: number;
    textLength: number;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSourceSnapshotClient(env);
  const acceptedAt = new Date().toISOString();

  const snapshotInsert = {
    source_id: input.source.id,
    provider: input.payload.provider,
    external_file_id: input.payload.fileId,
    schema_version: input.payload.schemaVersion,
    observed_at: input.payload.observedAt,
    accepted_at: acceptedAt,
    content_hash: input.contentHash,
    raw_payload: input.payload,
    processing_status: "pending_parse",
    tab_count: input.tabCount,
    table_count: input.tableCount,
    text_length: input.textLength,
  };

  const { data, error } = await client
    .from("timetable_source_snapshots")
    .insert(snapshotInsert)
    .select("id, content_hash")
    .single();

  if (error?.code === "23505") {
    const existing = await expectData(
      client
        .from("timetable_source_snapshots")
        .select("id, content_hash")
        .eq("source_id", input.source.id)
        .eq("content_hash", input.contentHash)
        .maybeSingle(),
      "Could not load the existing relay source snapshot.",
    );

    if (!existing) {
      throw new SourceSnapshotRepositoryError(
        "SOURCE_DATABASE_UNAVAILABLE",
        503,
        "The source snapshot already exists but could not be loaded.",
        error,
      );
    }

    await updateRelaySourceHealth(
      input.source.id,
      {
        last_observed_at: input.payload.observedAt,
        last_snapshot_received_at: acceptedAt,
        last_successful_snapshot_at: acceptedAt,
        last_error_at: null,
        last_error_code: null,
      },
      env,
    );

    return {
      status: "unchanged" as const,
      snapshotId: String((existing as JsonRecord).id),
      contentHash: String((existing as JsonRecord).content_hash),
    };
  }

  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not store the relay source snapshot.",
      error,
    );
  }

  await updateRelaySourceHealth(
    input.source.id,
    {
      last_observed_at: input.payload.observedAt,
      last_snapshot_received_at: acceptedAt,
      last_successful_snapshot_at: acceptedAt,
      last_error_at: null,
      last_error_code: null,
    },
    env,
  );

  return {
    status: "accepted" as const,
    snapshotId: String((data as JsonRecord).id),
    contentHash: String((data as JsonRecord).content_hash),
  };
}
