import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import {
  persistSourceSnapshotParseFailure,
  persistSourceSnapshotParseRun,
  type RelaySnapshotForParse,
} from "./sourceSnapshotParseRepository.js";
import { SourceSnapshotRepositoryError } from "./sourceSnapshotRepository.js";
import type {
  SourceDiscoveryCohort,
  SourceDiscoveryProgramme,
  SourceDraftMaterializationResult,
  SourceMappedCohort,
  SourceProcessingRepository,
  SourceProcessingSummary,
} from "./sourceProcessingService.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: SupabaseErrorLike | null };
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

function createProcessingClient(env: NodeJS.ProcessEnv = process.env) {
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

function mapProcessingSnapshot(row: JsonRecord): RelaySnapshotForParse {
  const source = Array.isArray(row.timetable_sources)
    ? (row.timetable_sources[0] as JsonRecord | undefined)
    : (row.timetable_sources as JsonRecord | undefined);
  return {
    acceptedAt: String(row.accepted_at),
    contentHash: String(row.content_hash),
    externalFileId: String(row.external_file_id),
    observedAt: String(row.observed_at),
    payload: row.raw_payload as RelaySnapshotForParse["payload"],
    parserProfile: source?.parser_profile
      ? String(source.parser_profile)
      : null,
    processingStatus: String(
      row.processing_status,
    ) as RelaySnapshotForParse["processingStatus"],
    provider: String(row.provider),
    snapshotId: String(row.id),
    sourceId: String(row.source_id),
    sourceKey: source?.source_key ? String(source.source_key) : "",
  };
}

function mapMappedCohort(row: JsonRecord): SourceMappedCohort {
  return {
    discoveryCohortId: String(row.id),
    sourceCohortCode: String(row.source_cohort_code),
    targetAcademicPeriodId: String(row.target_academic_period_id),
    targetCohortId: String(row.target_cohort_id),
    targetProgrammeId: String(row.target_programme_id),
  };
}

export async function enqueueSourceProcessingJob(
  input: { snapshotId: string; sourceId: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createProcessingClient(env);
  const { error } = await client
    .from("timetable_source_processing_jobs")
    .insert({
      snapshot_id: input.snapshotId,
      source_id: input.sourceId,
      status: "queued",
    });
  if (error?.code === "23505") return { status: "existing" as const };
  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not enqueue source processing.",
      error,
    );
  }
  return { status: "queued" as const };
}

export async function claimSourceProcessingJob(
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createProcessingClient(env);
  const data = await expectData<JsonRecord | JsonRecord[]>(
    client.rpc("claim_timetable_source_processing_job"),
    "Could not claim source processing work.",
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    id: String(row.id),
    snapshotId: String(row.snapshot_id),
  };
}

export async function markSourceProcessingJobFailed(
  input: {
    errorCode: string;
    errorMetadata?: Record<string, unknown>;
    snapshotId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createProcessingClient(env);
  const { error } = await client.rpc("fail_timetable_source_processing_job", {
    p_error_code: input.errorCode,
    p_error_metadata: input.errorMetadata ?? {},
    p_snapshot_id: input.snapshotId,
  });
  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_DATABASE_UNAVAILABLE",
      503,
      "Could not record source processing failure.",
      error,
    );
  }
}

export function createSourceProcessingRepository(
  env: NodeJS.ProcessEnv = process.env,
): SourceProcessingRepository {
  const loadSnapshot = async (snapshotId: string) => {
    const client = createProcessingClient(env);
    const data = await expectData<JsonRecord>(
      client
        .from("timetable_source_snapshots")
        .select(
          "id, source_id, provider, external_file_id, observed_at, accepted_at, content_hash, raw_payload, processing_status, timetable_sources(source_key, parser_profile)",
        )
        .eq("id", snapshotId)
        .maybeSingle(),
      "Could not load source snapshot for processing.",
    );
    if (!data) {
      throw new SourceSnapshotRepositoryError(
        "SOURCE_SNAPSHOT_NOT_FOUND",
        404,
        "The source snapshot could not be found.",
      );
    }
    return mapProcessingSnapshot(data);
  };

  return {
    listMappedCohorts: async (input) => {
      const client = createProcessingClient(env);
      const rows = await expectData<JsonRecord[]>(
        client
          .from("timetable_source_discovered_cohorts")
          .select(
            "id, source_cohort_code, target_programme_id, target_cohort_id, target_academic_period_id",
          )
          .eq("source_id", input.sourceId)
          .eq("mapping_status", "mapped")
          .eq("currently_present", true),
        "Could not load mapped source cohorts.",
      );
      return (rows ?? []).map(mapMappedCohort);
    },
    loadSnapshot,
    markJobCompleted: async (snapshotId, summary: SourceProcessingSummary) => {
      const client = createProcessingClient(env);
      const { error } = await client
        .from("timetable_source_processing_jobs")
        .update({
          completed_at: new Date().toISOString(),
          last_error_code: null,
          last_error_metadata: {},
          result_summary: summary,
          status: summary.draftsGenerated > 0 ? "review_ready" : "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("snapshot_id", snapshotId);
      if (error) {
        throw new SourceSnapshotRepositoryError(
          "SOURCE_DATABASE_UNAVAILABLE",
          503,
          "Could not complete source processing job.",
          error,
        );
      }
    },
    materializeDraft: async (input) => {
      if (input.sessions.length === 0) {
        return {
          draftVersionId: null,
          reviewId: null,
          sessionCount: 0,
          status: "no_actionable_sessions",
          timetableId: null,
        };
      }

      const client = createProcessingClient(env);
      const data = await expectData<JsonRecord | JsonRecord[]>(
        client.rpc("materialize_source_generated_draft", {
          p_discovered_cohort_id: input.mapping.discoveryCohortId,
          p_parse_run_id: input.parseRunId,
          p_parser_version: input.parserVersion,
          p_sessions: input.sessions,
          p_snapshot_id: input.snapshot.snapshotId,
        }),
        "Could not materialize source generated draft.",
      );
      const row = Array.isArray(data) ? data[0] : data;
      return {
        draftVersionId: row?.draft_version_id
          ? String(row.draft_version_id)
          : null,
        reviewId: row?.review_id ? String(row.review_id) : null,
        sessionCount: Number(row?.session_count ?? input.sessions.length),
        status: String(
          row?.status ?? "draft_generated",
        ) as SourceDraftMaterializationResult["status"],
        timetableId: row?.timetable_id ? String(row.timetable_id) : null,
      };
    },
    persistParseFailure: (input) =>
      persistSourceSnapshotParseFailure(input, env),
    persistParseRun: (input) => persistSourceSnapshotParseRun(input, env),
    upsertDiscovery: async (input) => {
      const client = createProcessingClient(env);
      const seenProgrammeCodes = input.programmes.map(
        (programme) => programme.sourceProgrammeCode,
      );
      const seenCohortCodes = input.cohorts.map(
        (cohort) => cohort.sourceCohortCode,
      );
      const programmes = input.programmes.map(
        (programme: SourceDiscoveryProgramme) => ({
          display_label: programme.displayLabel,
          first_seen_parse_run_id: input.parseRunId,
          currently_present: true,
          last_seen_parse_run_id: input.parseRunId,
          last_seen_at: new Date().toISOString(),
          session_count: programme.sessionCount,
          source_id: input.sourceId,
          source_programme_code: programme.sourceProgrammeCode,
        }),
      );
      const cohorts = input.cohorts.map((cohort: SourceDiscoveryCohort) => ({
        first_seen_parse_run_id: input.parseRunId,
        currently_present: true,
        last_seen_parse_run_id: input.parseRunId,
        last_seen_at: new Date().toISOString(),
        session_count: cohort.sessionCount,
        source_cohort_code: cohort.sourceCohortCode,
        source_id: input.sourceId,
        source_programme_code: cohort.sourceProgrammeCode,
      }));

      if (programmes.length > 0) {
        const programmeUpdate = client
          .from("timetable_source_discovered_programmes")
          .update({
            currently_present: false,
            updated_at: new Date().toISOString(),
          })
          .eq("source_id", input.sourceId);
        if (seenProgrammeCodes.length > 0) {
          await programmeUpdate.not(
            "source_programme_code",
            "in",
            `(${seenProgrammeCodes.map((code) => `"${code}"`).join(",")})`,
          );
        } else {
          await programmeUpdate;
        }
        const { error } = await client
          .from("timetable_source_discovered_programmes")
          .upsert(programmes, {
            onConflict: "source_id,source_programme_code",
          });
        if (error) {
          throw new SourceSnapshotRepositoryError(
            "SOURCE_DATABASE_UNAVAILABLE",
            503,
            "Could not update discovered source programmes.",
            error,
          );
        }
      }

      if (cohorts.length > 0) {
        const cohortUpdate = client
          .from("timetable_source_discovered_cohorts")
          .update({
            currently_present: false,
            updated_at: new Date().toISOString(),
          })
          .eq("source_id", input.sourceId);
        if (seenCohortCodes.length > 0) {
          await cohortUpdate.not(
            "source_cohort_code",
            "in",
            `(${seenCohortCodes.map((code) => `"${code}"`).join(",")})`,
          );
        } else {
          await cohortUpdate;
        }
        const { error } = await client
          .from("timetable_source_discovered_cohorts")
          .upsert(cohorts, { onConflict: "source_id,source_cohort_code" });
        if (error) {
          throw new SourceSnapshotRepositoryError(
            "SOURCE_DATABASE_UNAVAILABLE",
            503,
            "Could not update discovered source cohorts.",
            error,
          );
        }
      }
    },
  };
}
