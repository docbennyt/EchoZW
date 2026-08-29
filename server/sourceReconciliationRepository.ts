import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type {
  HitParsedSessionCandidate,
  HitParserResult,
} from "../src/domain/hitMasterSnapshotParser.js";
import {
  reconcileSourceCandidatesToPublishedTimetable,
  type ReconciliationBinding,
  type ReconciliationCurrentSession,
  type ReconciliationSourceCandidate,
} from "./sourceReconciliation.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: SupabaseErrorLike | null };
type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export type SourceReconciliationBindingRecord = ReconciliationBinding & {
  active: boolean;
  id: string;
};

export type PublishedTimetableForReconciliation = {
  academicPeriodId: string;
  academicPeriodName: string;
  classGroupLabel: string;
  institutionName: string;
  programmeName: string;
  publishedVersionId: string;
  sessions: ReconciliationCurrentSession[];
  timetableId: string;
};

export type SourceParseSelection = {
  parseRunId: string;
  parserVersion: string;
  snapshotId: string;
  sourceCandidates: ReconciliationSourceCandidate[];
  sourceKey: string;
};

export type CompareOnlyStateSnapshot = {
  calendarSubscriptionIds: string[];
  currentPublishedVersionId: string | null;
  feedTokenIds: string[];
  publishedSessionIds: string[];
  syncRecordIds: string[];
  timetableId: string;
  timetableVersionIds: string[];
};

export class SourceReconciliationRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function createRepositoryClient(env: NodeJS.ProcessEnv = process.env) {
  return createSupabaseAdminClient(env);
}

async function expectData<T>(
  query: PromiseLike<QueryResult<T>>,
  code: string,
  message: string,
) {
  const { data, error } = await query;
  if (error) {
    throw new SourceReconciliationRepositoryError(code, 503, message, error);
  }
  return data;
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeTimeValue(value: string | null | undefined) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return String(value ?? "").trim() || null;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
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
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalizeJsonValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return JSON.parse(JSON.stringify(value));
}

function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function mapBinding(row: JsonRecord): SourceReconciliationBindingRecord {
  return {
    active: Boolean(row.active),
    id: String(row.id),
    sourceCohortCode: String(row.source_cohort_code),
    sourceKey: String(row.source_key),
    targetAcademicPeriodName: String(row.target_academic_period_name),
    targetClassGroupLabel: String(row.target_class_group_label),
    targetPublicSlug: String(row.target_public_slug),
  };
}

function mapCurrentSession(
  row: JsonRecord,
  timetableId: string,
  publishedVersionId: string,
): ReconciliationCurrentSession {
  return {
    courseCode: String(row.course_code),
    courseName: String(row.course_name),
    endTime: normalizeTimeValue(String(row.end_time)) ?? "",
    lecturer: row.lecturer ? String(row.lecturer) : null,
    notes: row.notes ? String(row.notes) : null,
    publishedVersionId,
    sessionId: String(row.id),
    sessionType: row.session_type ? String(row.session_type) : null,
    stableSessionKey: row.stable_session_key
      ? String(row.stable_session_key)
      : null,
    startTime: normalizeTimeValue(String(row.start_time)) ?? "",
    timetableId,
    venue: row.venue ? String(row.venue) : null,
    weekday: Number(row.weekday),
  };
}

function mapSourceCandidate(
  candidate: HitParsedSessionCandidate,
  input: {
    parseRunId: string;
    parserVersion: string;
    snapshotId: string;
    sourceKey: string;
  },
): ReconciliationSourceCandidate {
  return {
    candidateId: candidate.id,
    cohortCode: candidate.cohortCode,
    courseCode: candidate.courseCodeResolved,
    courseExpressionRaw: candidate.courseExpressionRaw,
    courseName: candidate.courseName,
    endTime: normalizeTimeValue(candidate.endTime),
    lecturer: candidate.lecturerRaw,
    parseRunId: input.parseRunId,
    parserProvenance: candidate.provenance,
    parserVersion: input.parserVersion,
    parseWarnings: candidate.warnings as Array<Record<string, unknown>>,
    reviewStatus: candidate.reviewStatus,
    snapshotId: input.snapshotId,
    sourceCandidateKey: candidate.sourceCandidateKey,
    sourceKey: input.sourceKey,
    startTime: normalizeTimeValue(candidate.startTime),
    venue: candidate.venueRaw,
    weekday: candidate.weekday,
  };
}

export async function loadSourceReconciliationBinding(
  input: {
    sourceCohortCode: string;
    sourceKey: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createRepositoryClient(env);
  const data = await expectData(
    client
      .from("timetable_source_reconciliation_bindings")
      .select("*")
      .eq("source_key", input.sourceKey)
      .eq("source_cohort_code", input.sourceCohortCode)
      .eq("active", true)
      .maybeSingle(),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load the source reconciliation binding.",
  );
  if (!data) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_BINDING_NOT_FOUND",
      404,
      "No active source reconciliation binding exists for the requested source cohort.",
    );
  }
  return mapBinding(data as unknown as JsonRecord);
}

export async function loadLatestSuccessfulSourceParse(
  binding: ReconciliationBinding,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createRepositoryClient(env);
  const source = await expectData(
    client
      .from("timetable_sources")
      .select("id, source_key")
      .eq("source_key", binding.sourceKey)
      .maybeSingle(),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load the configured source for reconciliation.",
  );
  if (!source) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_SOURCE_NOT_FOUND",
      404,
      "The configured source key does not exist.",
    );
  }

  const snapshots = await expectData(
    client
      .from("timetable_source_snapshots")
      .select("id, accepted_at")
      .eq("source_id", String((source as JsonRecord).id))
      .order("accepted_at", { ascending: false })
      .limit(50),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load source snapshots for reconciliation.",
  );
  const snapshotRows = (snapshots ?? []) as unknown as JsonRecord[];
  if (snapshotRows.length === 0) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_PARSE_NOT_FOUND",
      404,
      "No source snapshots are available for reconciliation.",
    );
  }

  const snapshotIds = snapshotRows.map((row) => String(row.id));
  const parseRuns = await expectData(
    client
      .from("timetable_source_parse_runs")
      .select("*")
      .in("snapshot_id", snapshotIds)
      .order("completed_at", { ascending: false }),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load source parse runs for reconciliation.",
  );
  const parseRunRows = (parseRuns ?? []) as unknown as JsonRecord[];
  const parseRunsBySnapshot = new Map<string, JsonRecord[]>();
  for (const row of parseRunRows) {
    const snapshotId = String(row.snapshot_id);
    parseRunsBySnapshot.set(snapshotId, [
      ...(parseRunsBySnapshot.get(snapshotId) ?? []),
      row,
    ]);
  }

  let selectedParseRun: JsonRecord | null = null;
  let selectedSnapshotId: string | null = null;
  for (const snapshot of snapshotRows) {
    const snapshotId = String(snapshot.id);
    const candidate = (parseRunsBySnapshot.get(snapshotId) ?? []).find(
      (row) => String(row.status) !== "failed",
    );
    if (candidate) {
      selectedParseRun = candidate;
      selectedSnapshotId = snapshotId;
      break;
    }
  }

  if (!selectedParseRun || !selectedSnapshotId) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_PARSE_NOT_FOUND",
      404,
      "No successful persisted source parse run is available for reconciliation.",
    );
  }

  const parserResult = ((selectedParseRun.result_payload as JsonRecord | null) ??
    {}) as unknown as HitParserResult;
  const sourceCandidates = (parserResult.sessionCandidates ?? [])
    .filter(
      (candidate) =>
        candidate.cohortCode === binding.sourceCohortCode &&
        candidate.reviewStatus !== undefined,
    )
    .map((candidate) =>
      mapSourceCandidate(candidate, {
        parseRunId: String(selectedParseRun?.id),
        parserVersion: String(selectedParseRun?.parser_version),
        snapshotId: selectedSnapshotId,
        sourceKey: binding.sourceKey,
      }),
    );

  return {
    parseRunId: String(selectedParseRun.id),
    parserVersion: String(selectedParseRun.parser_version),
    snapshotId: selectedSnapshotId,
    sourceCandidates,
    sourceKey: binding.sourceKey,
  } satisfies SourceParseSelection;
}

export async function loadPublishedTimetableForBinding(
  binding: ReconciliationBinding,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createRepositoryClient(env);
  const timetable = await expectData(
    client
      .from("timetables")
      .select(
        "id, public_slug, current_published_version_id, academic_period_id, cohort_id, institutions(name), programmes(name), cohorts(label), academic_periods(id, name)",
      )
      .eq("public_slug", binding.targetPublicSlug)
      .maybeSingle(),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load the bound published timetable.",
  );
  if (!timetable) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_TIMETABLE_NOT_FOUND",
      404,
      "The bound timetable could not be found.",
    );
  }

  const timetableRow = timetable as unknown as JsonRecord;
  const cohort = asSingle(
    timetableRow.cohorts as JsonRecord | JsonRecord[] | null,
  );
  const academicPeriod = asSingle(
    timetableRow.academic_periods as JsonRecord | JsonRecord[] | null,
  );
  if ((cohort?.label ? String(cohort.label) : "") !== binding.targetClassGroupLabel) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_BINDING_MISMATCH",
      409,
      "The bound timetable no longer matches the configured class group label.",
    );
  }
  if (
    (academicPeriod?.name ? String(academicPeriod.name) : "") !==
    binding.targetAcademicPeriodName
  ) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_BINDING_MISMATCH",
      409,
      "The bound timetable no longer matches the configured academic period.",
    );
  }
  if (!timetableRow.current_published_version_id) {
    throw new SourceReconciliationRepositoryError(
      "SOURCE_RECONCILIATION_TIMETABLE_NOT_PUBLISHED",
      404,
      "The bound timetable does not currently have a published version.",
    );
  }

  const timetableId = String(timetableRow.id);
  const publishedVersionId = String(timetableRow.current_published_version_id);
  const sessions = await expectData(
    client
      .from("timetable_sessions")
      .select(
        "id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes",
      )
      .eq("timetable_version_id", publishedVersionId)
      .order("weekday")
      .order("start_time")
      .order("course_code"),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load the published timetable sessions for reconciliation.",
  );

  const institution = asSingle(
    timetableRow.institutions as JsonRecord | JsonRecord[] | null,
  );
  const programme = asSingle(
    timetableRow.programmes as JsonRecord | JsonRecord[] | null,
  );

  return {
    academicPeriodId: String(academicPeriod?.id),
    academicPeriodName: String(academicPeriod?.name),
    classGroupLabel: String(cohort?.label),
    institutionName: institution?.name ? String(institution.name) : "",
    programmeName: programme?.name ? String(programme.name) : "",
    publishedVersionId,
    sessions: (sessions ?? []).map((row: unknown) =>
      mapCurrentSession(row as JsonRecord, timetableId, publishedVersionId),
    ),
    timetableId,
  } satisfies PublishedTimetableForReconciliation;
}

export async function captureCompareOnlyState(
  input: {
    publishedVersionId: string;
    timetableId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createRepositoryClient(env);
  const timetable = await expectData(
    client
      .from("timetables")
      .select("id, current_published_version_id")
      .eq("id", input.timetableId)
      .maybeSingle(),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load the timetable publication pointer.",
  );
  const versions = await expectData(
    client
      .from("timetable_versions")
      .select("id")
      .eq("timetable_id", input.timetableId)
      .order("id"),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load timetable versions for compare-only verification.",
  );
  const sessions = await expectData(
    client
      .from("timetable_sessions")
      .select("id")
      .eq("timetable_version_id", input.publishedVersionId)
      .order("id"),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load published sessions for compare-only verification.",
  );
  const subscriptions = await expectData(
    client
      .from("calendar_subscriptions")
      .select("id")
      .eq("timetable_id", input.timetableId)
      .order("id"),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load calendar subscriptions for compare-only verification.",
  );
  const feedTokens = await expectData(
    client
      .from("feed_tokens")
      .select("id")
      .eq("timetable_id", input.timetableId)
      .order("id"),
    "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
    "Could not load feed tokens for compare-only verification.",
  );
  const subscriptionIds = (subscriptions ?? []).map((row: unknown) =>
    String((row as JsonRecord).id),
  );
  const syncRecords = subscriptionIds.length
    ? await expectData(
        client
          .from("calendar_event_sync_records")
          .select("id")
          .in("subscription_id", subscriptionIds)
          .order("id"),
        "SOURCE_RECONCILIATION_DATABASE_UNAVAILABLE",
        "Could not load calendar sync records for compare-only verification.",
      )
    : [];

  return {
    calendarSubscriptionIds: (subscriptions ?? []).map((row: unknown) =>
      String((row as JsonRecord).id),
    ),
    currentPublishedVersionId: timetable && (timetable as JsonRecord).current_published_version_id
      ? String((timetable as JsonRecord).current_published_version_id)
      : null,
    feedTokenIds: (feedTokens ?? []).map((row: unknown) =>
      String((row as JsonRecord).id),
    ),
    publishedSessionIds: (sessions ?? []).map((row: unknown) =>
      String((row as JsonRecord).id),
    ),
    syncRecordIds: (syncRecords ?? []).map((row: unknown) =>
      String((row as JsonRecord).id),
    ),
    timetableId: input.timetableId,
    timetableVersionIds: (versions ?? []).map((row: unknown) =>
      String((row as JsonRecord).id),
    ),
  } satisfies CompareOnlyStateSnapshot;
}

export type SourceReconciliationRepository = {
  captureCompareOnlyState: (
    input: {
      publishedVersionId: string;
      timetableId: string;
    },
  ) => Promise<CompareOnlyStateSnapshot>;
  loadBinding: (input: {
    sourceCohortCode: string;
    sourceKey: string;
  }) => Promise<SourceReconciliationBindingRecord>;
  loadLatestSuccessfulParse: (
    binding: ReconciliationBinding,
  ) => Promise<SourceParseSelection>;
  loadPublishedTimetable: (
    binding: ReconciliationBinding,
  ) => Promise<PublishedTimetableForReconciliation>;
};

export function createSourceReconciliationRepository(
  env: NodeJS.ProcessEnv = process.env,
): SourceReconciliationRepository {
  return {
    captureCompareOnlyState: (input) => captureCompareOnlyState(input, env),
    loadBinding: (input) => loadSourceReconciliationBinding(input, env),
    loadLatestSuccessfulParse: (binding) => loadLatestSuccessfulSourceParse(binding, env),
    loadPublishedTimetable: (binding) => loadPublishedTimetableForBinding(binding, env),
  };
}

export async function runSourceReconciliation(
  input: {
    sourceCohortCode: string;
    sourceKey: string;
  },
  repository = createSourceReconciliationRepository(),
) {
  const binding = await repository.loadBinding(input);
  const publishedTimetable = await repository.loadPublishedTimetable(binding);
  const before = await repository.captureCompareOnlyState({
    publishedVersionId: publishedTimetable.publishedVersionId,
    timetableId: publishedTimetable.timetableId,
  });
  const sourceParse = await repository.loadLatestSuccessfulParse(binding);

  const reconciliation = reconcileSourceCandidatesToPublishedTimetable({
    binding,
    cohort: binding.sourceCohortCode,
    currentSessions: publishedTimetable.sessions,
    publishedVersionId: publishedTimetable.publishedVersionId,
    sourceCandidates: sourceParse.sourceCandidates,
    sourceSnapshotId: sourceParse.snapshotId,
    timetableId: publishedTimetable.timetableId,
  });

  const after = await repository.captureCompareOnlyState({
    publishedVersionId: publishedTimetable.publishedVersionId,
    timetableId: publishedTimetable.timetableId,
  });

  return {
    ...reconciliation,
    binding,
    current: publishedTimetable,
    parseRunId: sourceParse.parseRunId,
    parserVersion: sourceParse.parserVersion,
    zeroMutationProof: {
      after,
      before,
      noMutationsObserved: canonicalJsonString(before) === canonicalJsonString(after),
    },
  };
}
