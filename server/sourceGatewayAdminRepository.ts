import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { enqueueSourceProcessingJob } from "./sourceProcessingRepository.js";
import { SourceSnapshotRepositoryError } from "./sourceSnapshotRepository.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: SupabaseErrorLike | null };
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

async function expectData<T>(
  query: PromiseLike<QueryResult<T>>,
  message: string,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_GATEWAY_DATABASE_UNAVAILABLE",
      503,
      message,
      error,
    );
  }
  return data;
}

function client() {
  return createSupabaseAdminClient();
}

function invalidMapping(message: string, details?: unknown): never {
  throw new SourceSnapshotRepositoryError(
    "SOURCE_GATEWAY_MAPPING_INVALID",
    422,
    message,
    details,
  );
}

async function loadLatestSourceSnapshot(sourceId: string) {
  const snapshot = await expectData<JsonRecord>(
    client()
      .from("timetable_source_snapshots")
      .select("id, source_id")
      .eq("source_id", sourceId)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Could not load latest source snapshot.",
  );
  if (!snapshot) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_SNAPSHOT_NOT_FOUND",
      404,
      "No source snapshot is available to process.",
    );
  }
  return snapshot;
}

async function requeueExistingSourceProcessingJob(snapshotId: string) {
  const now = new Date().toISOString();
  const supabase = client();
  const { data, error } = await supabase
    .from("timetable_source_processing_jobs")
    .update({
      available_at: now,
      completed_at: null,
      last_error_code: null,
      last_error_metadata: {},
      result_summary: {},
      started_at: null,
      status: "queued",
      updated_at: now,
    })
    .eq("snapshot_id", snapshotId)
    .neq("status", "processing")
    .select("id, status")
    .maybeSingle();

  if (error) {
    throw new SourceSnapshotRepositoryError(
      "SOURCE_GATEWAY_DATABASE_UNAVAILABLE",
      503,
      "Could not requeue the latest source snapshot.",
      error,
    );
  }

  return data
    ? { status: "queued" as const }
    : { status: "existing" as const };
}

async function validateCohortMappingTarget(input: {
  discoveredCohortId: string;
  targetAcademicPeriodId: string;
  targetCohortId: string;
  targetProgrammeId: string;
}) {
  const supabase = client();
  const [discovered, programme, cohort, period] = await Promise.all([
    expectData<JsonRecord>(
      supabase
        .from("timetable_source_discovered_cohorts")
        .select("id, source_id, source_programme_code")
        .eq("id", input.discoveredCohortId)
        .maybeSingle(),
      "Could not load the discovered cohort mapping target.",
    ),
    expectData<JsonRecord>(
      supabase
        .from("programmes")
        .select("id, institution_id")
        .eq("id", input.targetProgrammeId)
        .maybeSingle(),
      "Could not validate the target programme.",
    ),
    expectData<JsonRecord>(
      supabase
        .from("cohorts")
        .select("id, programme_id")
        .eq("id", input.targetCohortId)
        .maybeSingle(),
      "Could not validate the target class group.",
    ),
    expectData<JsonRecord>(
      supabase
        .from("academic_periods")
        .select("id, institution_id")
        .eq("id", input.targetAcademicPeriodId)
        .maybeSingle(),
      "Could not validate the target academic period.",
    ),
  ]);

  if (!discovered || !programme || !cohort || !period) {
    invalidMapping("Choose an existing programme, class group, and academic period.");
  }

  if (String(cohort.programme_id) !== input.targetProgrammeId) {
    invalidMapping(
      "The selected class group does not belong to the selected programme.",
      {
        targetCohortId: input.targetCohortId,
        targetProgrammeId: input.targetProgrammeId,
      },
    );
  }

  if (String(period.institution_id) !== String(programme.institution_id)) {
    invalidMapping(
      "The selected academic period does not belong to the programme institution.",
      {
        targetAcademicPeriodId: input.targetAcademicPeriodId,
        targetProgrammeId: input.targetProgrammeId,
      },
    );
  }

  const programmeMapping = await expectData<JsonRecord>(
    supabase
      .from("timetable_source_discovered_programmes")
      .select("mapping_status, target_programme_id")
      .eq("source_id", String(discovered.source_id))
      .eq("source_programme_code", String(discovered.source_programme_code))
      .maybeSingle(),
    "Could not validate the source programme mapping.",
  );

  if (
    programmeMapping?.mapping_status === "mapped" &&
    String(programmeMapping.target_programme_id) !== input.targetProgrammeId
  ) {
    invalidMapping(
      "This source programme is already mapped to a different CalenderZW programme.",
      {
        sourceProgrammeCode: String(discovered.source_programme_code),
        targetProgrammeId: input.targetProgrammeId,
      },
    );
  }
}

export async function listSourceGatewayState() {
  const supabase = client();
  const [sources, programmes, cohorts, reviews, jobs] = await Promise.all([
    expectData<JsonRecord[]>(
      supabase
        .from("timetable_sources")
        .select(
          "id, source_key, display_name, provider, external_file_id, active, parser_profile, relay_secret_env_name, last_snapshot_received_at, last_successful_snapshot_at, last_error_at, last_error_code, last_processing_completed_at, last_processing_error_at, last_processing_error_code",
        )
        .order("display_name"),
      "Could not load Source Gateway sources.",
    ),
    expectData<JsonRecord[]>(
      supabase
        .from("timetable_source_discovered_programmes")
        .select(
          "id, source_id, source_programme_code, display_label, session_count, currently_present, mapping_status, target_programme_id, reviewed_at",
        )
        .order("source_programme_code"),
      "Could not load discovered source programmes.",
    ),
    expectData<JsonRecord[]>(
      supabase
        .from("timetable_source_discovered_cohorts")
        .select(
          "id, source_id, source_cohort_code, source_programme_code, session_count, currently_present, mapping_status, target_programme_id, target_cohort_id, target_academic_period_id, reviewed_at",
        )
        .order("source_cohort_code"),
      "Could not load discovered source cohorts.",
    ),
    expectData<JsonRecord[]>(
      supabase
        .from("timetable_source_reviews")
        .select(
          "id, source_id, source_cohort_code, timetable_id, draft_version_id, status, summary, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      "Could not load source reviews.",
    ),
    expectData<JsonRecord[]>(
      supabase
        .from("timetable_source_processing_jobs")
        .select(
          "id, source_id, snapshot_id, status, attempt_count, last_error_code, result_summary, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      "Could not load source processing jobs.",
    ),
  ]);

  return {
    cohorts: cohorts ?? [],
    jobs: jobs ?? [],
    programmes: programmes ?? [],
    reviews: reviews ?? [],
    sources: (sources ?? []).map((source) => ({
      ...source,
      relay_secret_configured: Boolean(source.relay_secret_env_name),
      relay_secret_env_name: source.relay_secret_env_name ?? null,
    })),
  };
}

export async function mapSourceProgramme(input: {
  discoveredProgrammeId: string;
  targetProgrammeId: string;
  userId: string;
}) {
  const data = await expectData<JsonRecord>(
    client()
      .from("timetable_source_discovered_programmes")
      .update({
        mapping_status: "mapped",
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.userId,
        target_programme_id: input.targetProgrammeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.discoveredProgrammeId)
      .select("id, mapping_status, target_programme_id")
      .single(),
    "Could not save source programme mapping.",
  );
  return data;
}

export async function mapSourceCohort(input: {
  discoveredCohortId: string;
  targetAcademicPeriodId: string;
  targetCohortId: string;
  targetProgrammeId: string;
  userId: string;
}) {
  await validateCohortMappingTarget(input);

  const data = await expectData<JsonRecord>(
    client()
      .from("timetable_source_discovered_cohorts")
      .update({
        mapping_status: "mapped",
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.userId,
        target_academic_period_id: input.targetAcademicPeriodId,
        target_cohort_id: input.targetCohortId,
        target_programme_id: input.targetProgrammeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.discoveredCohortId)
      .select(
        "id, source_id, mapping_status, target_programme_id, target_cohort_id, target_academic_period_id",
      )
      .single(),
    "Could not save source cohort mapping.",
  );

  if (data?.source_id) {
    await enqueueLatestSourceSnapshot(String(data.source_id));
  }

  return data;
}

export async function enqueueLatestSourceSnapshot(sourceId: string) {
  const snapshot = await loadLatestSourceSnapshot(sourceId);
  const result = await enqueueSourceProcessingJob(
    {
      snapshotId: String(snapshot.id),
      sourceId: String(snapshot.source_id),
    },
    process.env,
  );

  if (result.status === "queued") return result;
  return requeueExistingSourceProcessingJob(String(snapshot.id));
}
