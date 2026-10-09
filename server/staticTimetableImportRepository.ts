import { createHash } from "node:crypto";
import {
  parseStaticTimetableDocument,
  STATIC_TIMETABLE_DOCX_PARSER_VERSION,
  type StaticTimetableParseResult,
  type StaticTimetableIgnoredRecord,
} from "../src/domain/staticTimetableDocument.js";
import { buildStaticTimetableEvidence } from "../src/domain/staticTimetableEvidence.js";
import { readStructuredDocx } from "./docxStructuredReader.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const STATIC_TIMETABLE_IMPORT_MODE = "static_timetable_document";
const LEGACY_STATIC_TIMETABLE_IMPORT_MODE = "cohort_docx";

export function canReuseStaticTimetableImportBatch(input: {
  importMode: string | null | undefined;
  parserVersion: string | null | undefined;
}) {
  return (
    input.parserVersion === STATIC_TIMETABLE_DOCX_PARSER_VERSION &&
    (input.importMode === STATIC_TIMETABLE_IMPORT_MODE ||
      input.importMode === LEGACY_STATIC_TIMETABLE_IMPORT_MODE)
  );
}

export class StaticTimetableImportError extends Error {
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

function dbError(
  code: string,
  message: string,
  error: SupabaseErrorLike | null,
): never {
  throw new StaticTimetableImportError(code, message, 503, error);
}

function asRecord(value: unknown) {
  return value as JsonRecord;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en");
}

export async function getStaticTimetableImportOptions(
  institutionId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const supabase = client(env);
  const { data: institutions, error: institutionError } = await supabase
    .from("institutions")
    .select("id,name,slug")
    .order("name");
  if (institutionError) {
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load institutions for static timetable import.",
      institutionError,
    );
  }

  if (!institutionId) {
    return {
      institutions: institutions ?? [],
      programmes: [],
      cohorts: [],
      academicPeriods: [],
    };
  }

  const [
    { data: programmes, error: programmeError },
    { data: periods, error: periodError },
  ] = await Promise.all([
    supabase
      .from("programmes")
      .select("id,institution_id,name,short_name,code,academic_unit_id,status")
      .eq("institution_id", institutionId)
      .eq("status", "active")
      .order("name"),
    supabase
      .from("academic_periods")
      .select(
        "id,institution_id,name,academic_year,period_number,starts_on,ends_on,status",
      )
      .eq("institution_id", institutionId)
      .order("academic_year", { ascending: false })
      .order("period_number"),
  ]);
  if (programmeError) {
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load programmes for static timetable import.",
      programmeError,
    );
  }
  if (periodError) {
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load academic periods for static timetable import.",
      periodError,
    );
  }

  const programmeIds = (programmes ?? []).map((row) =>
    String(asRecord(row).id),
  );
  let cohorts: unknown[] = [];
  if (programmeIds.length > 0) {
    const { data, error } = await supabase
      .from("cohorts")
      .select(
        "id,programme_id,code,label,level_label,intake_label,group_name,group_label,year_level,semester_number,status",
      )
      .in("programme_id", programmeIds)
      .eq("status", "active")
      .order("label");
    if (error) {
      dbError(
        "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
        "Could not load cohorts for static timetable import.",
        error,
      );
    }
    cohorts = data ?? [];
  }

  return {
    institutions: institutions ?? [],
    programmes: programmes ?? [],
    cohorts,
    academicPeriods: periods ?? [],
  };
}

async function inferCanonicalSuggestions(
  institutionId: string,
  parsed: StaticTimetableParseResult,
  env: NodeJS.ProcessEnv,
) {
  const options = await getStaticTimetableImportOptions(institutionId, env);
  const department = normalizeText(parsed.metadata.departmentName);
  const programmes = (options.programmes as JsonRecord[]).filter(
    (programme) => {
      const values = [programme.name, programme.short_name, programme.code]
        .map(normalizeText)
        .filter(Boolean);
      return department !== "" && values.includes(department);
    },
  );
  const programmeId = programmes.length === 1 ? String(programmes[0].id) : null;

  const expectedLevel = parsed.metadata.yearLevel;
  const cohorts = (options.cohorts as JsonRecord[]).filter((cohort) => {
    if (!programmeId || String(cohort.programme_id) !== programmeId)
      return false;
    if (expectedLevel === null) return false;
    const values = [cohort.label, cohort.level_label, cohort.code]
      .map((value) => normalizeText(value))
      .filter(Boolean);
    return values.some(
      (value) =>
        value === String(expectedLevel) ||
        value === `part ${expectedLevel}` ||
        value === `part${expectedLevel}` ||
        value === `level ${expectedLevel}` ||
        value === `level${expectedLevel}`,
    );
  });
  const cohortId = cohorts.length === 1 ? String(cohorts[0].id) : null;

  const normalizeAcademicYear = (value: unknown) =>
    String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace("/", "-");
  const periods = (options.academicPeriods as JsonRecord[]).filter(
    (period) =>
      normalizeAcademicYear(period.academic_year) ===
        normalizeAcademicYear(
          parsed.metadata.academicYearRaw ?? parsed.metadata.academicYear,
        ) &&
      Number(period.period_number) === parsed.metadata.semesterNumber,
  );
  const academicPeriodId = periods.length === 1 ? String(periods[0].id) : null;
  return { programmeId, cohortId, academicPeriodId };
}

function parserSummaryPayload(parsed: StaticTimetableParseResult) {
  return {
    metadata: parsed.metadata,
    summary: parsed.summary,
    courses: parsed.courses,
    sessions: parsed.sessions,
    unparsed: parsed.unparsed,
    ignored: parsed.ignored,
  };
}

async function findExistingBatch(
  sourceDocumentId: string,
  env: NodeJS.ProcessEnv,
) {
  const query = await client(env)
    .from("import_batches")
    .select("id")
    .eq("source_document_id", sourceDocumentId)
    .in("import_mode", [
      STATIC_TIMETABLE_IMPORT_MODE,
      LEGACY_STATIC_TIMETABLE_IMPORT_MODE,
    ])
    .eq("parser_version", STATIC_TIMETABLE_DOCX_PARSER_VERSION)
    .maybeSingle();
  if (query.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check an existing static timetable parse run.",
      query.error,
    );
  }
  return query.data ? String(asRecord(query.data).id) : null;
}

function isMeaningfulIgnoredRecord(record: StaticTimetableIgnoredRecord) {
  return record.kind !== "blank" || record.rawText.trim() !== "";
}

export function buildStaticTimetablePersistencePayload(
  parsed: StaticTimetableParseResult,
  input: { filename: string; sha256: string },
) {
  const documentCandidateKey = `document:${input.sha256}`;
  const evidence = buildStaticTimetableEvidence(parsed);
  const candidateRows = [
    {
      candidate_key: documentCandidateKey,
      source_table: null,
      source_row: null,
      source_column: null,
      source_cell: null,
      raw_text: parsed.metadata.title ?? input.filename,
      candidate_type: "non_session",
      review_status: "valid",
      normalized_payload: { metadata: parsed.metadata },
    },
    ...parsed.courses.map((course) => ({
      candidate_key: course.candidateKey,
      source_table: course.sourceTableIndex,
      source_row: course.sourceRowIndex,
      source_column: null,
      source_cell: `r${course.sourceRowIndex}`,
      raw_text: course.rawCells.join(" | "),
      candidate_type: "course_catalog",
      course_code_raw: course.courseCodeRaw,
      course_name_raw: course.courseName,
      lecturer_raw: course.lecturerRaw,
      review_status: "valid",
      normalized_payload: course,
    })),
    ...parsed.sessions.map((session) => ({
      candidate_key: session.candidateKey,
      source_table: session.sourceTableIndex,
      source_row: session.sourceRowIndex,
      source_column: session.sourceColumnIndex,
      source_cell: `r${session.sourceRowIndex}c${session.sourceColumnIndex}`,
      raw_text: session.rawText,
      candidate_type: "session",
      course_code_raw: session.courseCodeRaw,
      course_name_raw: session.courseName,
      day_raw: session.weekdayLabel,
      weekday: session.weekday,
      time_raw: `${session.startTime}-${session.endTime}`,
      start_time: session.startTime,
      end_time: session.endTime,
      venue_raw: session.venueRaw,
      lecturer_raw: session.lecturerRaw,
      delivery_mode_raw: session.deliveryModeRaw,
      review_status: session.warningCodes.some(
        (code) => code === "COURSE_NOT_IN_REFERENCE",
      )
        ? "invalid"
        : session.warningCodes.length
          ? "warning"
          : "valid",
      normalized_payload: session,
    })),
    ...parsed.unparsed.map((candidate) => ({
      candidate_key: candidate.candidateKey,
      source_table: candidate.sourceTableIndex,
      source_row: candidate.sourceRowIndex,
      source_column: candidate.sourceColumnIndex,
      source_cell: `r${candidate.sourceRowIndex}c${candidate.sourceColumnIndex}`,
      raw_text: candidate.rawText,
      candidate_type: "session",
      day_raw: candidate.weekdayLabel,
      weekday: candidate.weekday,
      time_raw: `${candidate.startTime}-${candidate.endTime}`,
      start_time: candidate.startTime,
      end_time: candidate.endTime,
      review_status: "invalid",
      normalized_payload: candidate,
    })),
    ...parsed.ignored
      .filter(isMeaningfulIgnoredRecord)
      .map((record, index) => ({
        candidate_key: `ignored:${record.sourceTableIndex}:${record.sourceRowIndex}:${index}`,
        source_table: record.sourceTableIndex,
        source_row: record.sourceRowIndex,
        source_column: null,
        source_cell: `r${record.sourceRowIndex}`,
        raw_text: record.rawText,
        candidate_type: "ignored_row",
        time_raw:
          record.startTime && record.endTime
            ? `${record.startTime}-${record.endTime}`
            : null,
        start_time: record.startTime,
        end_time: record.endTime,
        review_status: "ignored",
        normalized_payload: record,
      })),
  ];
  const candidateKeys = new Set(
    candidateRows.map((candidate) => candidate.candidate_key),
  );

  return {
    documentCandidateKey,
    candidateRows,
    warningRows: parsed.warnings
      .map((warning) => ({
        candidate_key: warning.candidateKey ?? documentCandidateKey,
        warning_code: warning.code,
        severity: warning.severity === "error" ? "blocking" : "warning",
        message: warning.message,
        field_name: warning.fieldName,
        suggested_value: null,
      }))
      .filter((warning) => candidateKeys.has(warning.candidate_key)),
    targetRows: evidence.proposedTargets.map((target) => ({
      target_key: target.targetKey,
      title_raw: target.titleRaw,
      academic_unit_name_raw: target.departmentNameRaw,
      year_level_raw: target.yearLevelRaw,
      year_level: target.yearLevel,
      semester_raw: target.semesterRaw,
      semester_number: target.semesterNumber,
      academic_year_raw: target.academicYearRaw,
      confidence: target.confidence,
      review_status: target.confidence >= 0.85 ? "valid" : "warning",
      normalized_payload: target.normalizedPayload,
    })),
    candidateTargetRows: evidence.candidateTargets
      .filter((target) => candidateKeys.has(target.candidateKey))
      .map((target) => ({
        candidate_key: target.candidateKey,
        target_key: target.targetKey,
        applicability_raw: target.applicabilityRaw,
        confidence: target.confidence,
        review_status: target.reviewStatus,
        normalized_payload: target.normalizedPayload,
      })),
  };
}

export async function createStaticTimetableImport(
  input: {
    institutionId: string;
    actorId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!input.filename.toLocaleLowerCase("en").endsWith(".docx")) {
    throw new StaticTimetableImportError(
      "DOCX_REQUIRED",
      "Static timetable import currently accepts DOCX files only.",
      422,
    );
  }

  const supabase = client(env);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storagePath = `${input.institutionId}/${sha256}/source.docx`;
  const mimeType =
    input.mimeType ||
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const sourceLookup = await supabase
    .from("source_documents")
    .select("*")
    .eq("institution_id", input.institutionId)
    .eq("sha256", sha256)
    .maybeSingle();
  let sourceDocument = sourceLookup.data;
  const sourceLookupError = sourceLookup.error;
  if (sourceLookupError) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check existing static timetable evidence.",
      sourceLookupError,
    );
  }

  if (!sourceDocument) {
    const upload = await supabase.storage
      .from("timetable-sources")
      .upload(storagePath, input.bytes, {
        contentType: mimeType,
        upsert: false,
      });
    if (
      upload.error &&
      !String(upload.error.message).toLowerCase().includes("already exists")
    ) {
      throw new StaticTimetableImportError(
        "STATIC_IMPORT_STORAGE_FAILED",
        "Could not persist the immutable source document.",
        503,
        upload.error,
      );
    }

    const inserted = await supabase
      .from("source_documents")
      .insert({
        institution_id: input.institutionId,
        original_filename: input.filename,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: input.bytes.length,
        sha256,
        document_type: "static_timetable_document",
        source_status: "uploaded",
        uploaded_by: input.actorId,
        parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
        metadata: {},
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      if ((inserted.error as SupabaseErrorLike | null)?.code === "23505") {
        const concurrent = await supabase
          .from("source_documents")
          .select("*")
          .eq("institution_id", input.institutionId)
          .eq("sha256", sha256)
          .maybeSingle();
        if (concurrent.error || !concurrent.data) {
          dbError(
            "STATIC_IMPORT_DATABASE_UNAVAILABLE",
            "The static timetable source was stored concurrently but could not be loaded.",
            concurrent.error,
          );
        }
        sourceDocument = concurrent.data;
      } else {
        dbError(
          "STATIC_IMPORT_DATABASE_UNAVAILABLE",
          "Could not register the immutable source document.",
          inserted.error,
        );
      }
    } else {
      sourceDocument = inserted.data;
    }
  }

  const documentId = String(asRecord(sourceDocument).id);
  const existingBatchId = await findExistingBatch(documentId, env);
  if (existingBatchId) {
    return getStaticTimetableImport(existingBatchId, env);
  }

  const { error: parsingStatusError } = await supabase
    .from("source_documents")
    .update({
      source_status: "parsing",
      parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
    })
    .eq("id", documentId);
  if (parsingStatusError) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not mark the retained source document for deterministic parsing.",
      parsingStatusError,
    );
  }

  let parsed: StaticTimetableParseResult;
  try {
    parsed = parseStaticTimetableDocument(readStructuredDocx(input.bytes));
  } catch (error) {
    const parserError = error instanceof Error ? error.message : "UNKNOWN";
    await supabase
      .from("source_documents")
      .update({
        source_status: "rejected",
        parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
        metadata: { parserError },
      })
      .eq("id", documentId);
    throw new StaticTimetableImportError(
      "DOCX_PARSE_FAILED",
      "CalenderZW could not safely interpret this DOCX timetable. The source evidence was retained for audit and no timetable was created.",
      422,
      { parserError },
    );
  }

  const { error: parsedStatusError } = await supabase
    .from("source_documents")
    .update({
      source_status: "parsed",
      parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
      metadata: { parsedMetadata: parsed.metadata },
    })
    .eq("id", documentId);
  if (parsedStatusError) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not persist the deterministic parser result metadata.",
      parsedStatusError,
    );
  }

  const suggestions = await inferCanonicalSuggestions(
    input.institutionId,
    parsed,
    env,
  );
  const { candidateRows, warningRows, targetRows, candidateTargetRows } =
    buildStaticTimetablePersistencePayload(parsed, {
      filename: input.filename,
      sha256,
    });

  const persisted = await supabase.rpc("persist_static_document_import_v2", {
    p_source_document_id: documentId,
    p_actor_id: input.actorId,
    p_parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
    p_summary: { ...parserSummaryPayload(parsed), suggestions },
    p_candidates: candidateRows,
    p_warnings: warningRows,
    p_targets: targetRows,
    p_candidate_targets: candidateTargetRows,
  });
  if (persisted.error || !persisted.data) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not atomically persist the static timetable review evidence.",
      persisted.error,
    );
  }

  return getStaticTimetableImport(String(persisted.data), env);
}

export async function getStaticTimetableImport(
  batchId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const supabase = client(env);
  const batchQuery = await supabase
    .from("import_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (batchQuery.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load the static timetable import review.",
      batchQuery.error,
    );
  }
  if (!batchQuery.data) {
    throw new StaticTimetableImportError(
      "STATIC_IMPORT_NOT_FOUND",
      "Static timetable import not found.",
      404,
    );
  }
  const batch = asRecord(batchQuery.data);
  const documentQuery = await supabase
    .from("source_documents")
    .select("*")
    .eq("id", String(batch.source_document_id))
    .maybeSingle();
  if (documentQuery.error || !documentQuery.data) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load static timetable source evidence.",
      documentQuery.error,
    );
  }

  const candidatesQuery = await supabase
    .from("import_candidates")
    .select("id,candidate_key")
    .eq("import_batch_id", batchId);
  if (candidatesQuery.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load static timetable candidate evidence.",
      candidatesQuery.error,
    );
  }
  const candidateRows = (candidatesQuery.data ?? []) as unknown as JsonRecord[];
  const candidateKeys = new Map(
    candidateRows.map((row) => [
      String(row.id),
      row.candidate_key ? String(row.candidate_key) : null,
    ]),
  );
  const candidateIdsByKey = new Map(
    candidateRows.map((row) => [
      row.candidate_key ? String(row.candidate_key) : "",
      String(row.id),
    ]),
  );
  const targetsQuery = await supabase
    .from("import_targets")
    .select(
      "id,target_key,title_raw,academic_unit_name_raw,year_level,semester_number,academic_year_raw,review_status,matched_programme_id,matched_cohort_id,matched_academic_period_id",
    )
    .eq("import_batch_id", batchId)
    .order("target_key");
  const hasTargetTable =
    !targetsQuery.error ||
    (targetsQuery.error as SupabaseErrorLike).code !== "42P01";
  if (targetsQuery.error && hasTargetTable) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load static timetable target evidence.",
      targetsQuery.error,
    );
  }
  const targetRows = hasTargetTable
    ? ((targetsQuery.data ?? []) as unknown as JsonRecord[])
    : [];
  let candidateTargetRows: JsonRecord[] = [];
  if (hasTargetTable && targetRows.length > 0 && candidateRows.length > 0) {
    const targetLinksQuery = await supabase
      .from("import_candidate_targets")
      .select("candidate_id,import_target_id")
      .in(
        "import_target_id",
        targetRows.map((row) => String(row.id)),
      );
    if (targetLinksQuery.error) {
      dbError(
        "STATIC_IMPORT_DATABASE_UNAVAILABLE",
        "Could not load static timetable target applicability.",
        targetLinksQuery.error,
      );
    }
    candidateTargetRows = (targetLinksQuery.data ??
      []) as unknown as JsonRecord[];
  }
  let warningRows: JsonRecord[] = [];
  if (candidateRows.length > 0) {
    const warningsQuery = await supabase
      .from("import_candidate_warnings")
      .select(
        "id,candidate_id,warning_code,severity,message,field_name,resolution_note,resolved_at",
      )
      .in(
        "candidate_id",
        candidateRows.map((row) => String(row.id)),
      )
      .order("created_at");
    if (warningsQuery.error) {
      dbError(
        "STATIC_IMPORT_DATABASE_UNAVAILABLE",
        "Could not load static timetable warnings.",
        warningsQuery.error,
      );
    }
    warningRows = (warningsQuery.data ?? []) as unknown as JsonRecord[];
  }

  const summary = asRecord(batch.summary ?? {});
  const parsedSummary = asRecord(summary.summary ?? {});
  const document = asRecord(documentQuery.data);
  const versionQuery = await supabase
    .from("timetable_versions")
    .select("id,timetable_id,import_target_id")
    .eq("import_batch_id", batchId);
  if (versionQuery.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check the created static timetable drafts.",
      versionQuery.error,
    );
  }

  const targetDrafts = new Map<string, Record<string, unknown>>();
  let createdDraft: null | Record<string, unknown> = null;
  for (const versionRow of (versionQuery.data ?? []) as unknown as JsonRecord[]) {
    const timetable = await supabase
      .from("timetables")
      .select("public_slug")
      .eq("id", String(versionRow.timetable_id))
      .maybeSingle();
    const count = await supabase
      .from("timetable_sessions")
      .select("id", { count: "exact", head: true })
      .eq("timetable_version_id", String(versionRow.id));
    const draft = {
      timetableId: String(versionRow.timetable_id),
      draftVersionId: String(versionRow.id),
      publicSlug: timetable.data
        ? String(asRecord(timetable.data).public_slug ?? "")
        : "",
      sessionCount: count.count ?? 0,
    };
    createdDraft ??= draft;
    if (versionRow.import_target_id) {
      targetDrafts.set(String(versionRow.import_target_id), draft);
    }
  }

  return {
    batch: {
      id: String(batch.id),
      status: String(batch.status),
      parserVersion: String(batch.parser_version),
      createdAt: String(batch.created_at),
      summary: parsedSummary,
    },
    document: {
      id: String(document.id),
      institutionId: String(document.institution_id),
      originalFilename: String(document.original_filename),
      mimeType: String(document.mime_type),
      fileSizeBytes: Number(document.file_size_bytes),
      sha256: String(document.sha256),
      sourceStatus: String(document.source_status),
      storagePath: String(document.storage_path),
    },
    parsed: {
      metadata: summary.metadata ?? {},
      summary: parsedSummary,
      courses: summary.courses ?? [],
      sessions: summary.sessions ?? [],
      unparsed: summary.unparsed ?? [],
      ignored: summary.ignored ?? [],
    },
    warnings: warningRows.map((row) => ({
      id: String(row.id),
      candidateId: String(row.candidate_id),
      candidateKey: candidateKeys.get(String(row.candidate_id)) ?? null,
      code: String(row.warning_code),
      severity: String(row.severity),
      message: String(row.message),
      fieldName: row.field_name ? String(row.field_name) : null,
      resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    })),
    targets: targetRows.map((target) => ({
      id: String(target.id),
      targetKey: String(target.target_key),
      titleRaw: String(target.title_raw),
      academicUnitNameRaw: target.academic_unit_name_raw
        ? String(target.academic_unit_name_raw)
        : null,
      yearLevel:
        target.year_level === null || target.year_level === undefined
          ? null
          : Number(target.year_level),
      semesterNumber:
        target.semester_number === null || target.semester_number === undefined
          ? null
          : Number(target.semester_number),
      academicYearRaw: target.academic_year_raw
        ? String(target.academic_year_raw)
        : null,
      reviewStatus: String(target.review_status),
      matchedProgrammeId: target.matched_programme_id
        ? String(target.matched_programme_id)
        : null,
      matchedCohortId: target.matched_cohort_id
        ? String(target.matched_cohort_id)
        : null,
      matchedAcademicPeriodId: target.matched_academic_period_id
        ? String(target.matched_academic_period_id)
        : null,
      createdDraft: targetDrafts.get(String(target.id)) ?? null,
      candidateKeys: candidateTargetRows
        .filter((link) => String(link.import_target_id) === String(target.id))
        .map((link) => {
          const candidateId = String(link.candidate_id);
          return [...candidateIdsByKey.entries()].find(
            ([, id]) => id === candidateId,
          )?.[0];
        })
        .filter((value): value is string => Boolean(value)),
    })),
    suggestions: asRecord(summary.suggestions ?? {}),
    createdDraft,
  };
}

export async function updateStaticTimetableImportTargetMapping(
  input: {
    batchId: string;
    targetId: string;
    programmeId: string | null;
    cohortId: string | null;
    academicPeriodId: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const supabase = client(env);
  const batch = await supabase
    .from("import_batches")
    .select("id,source_document_id")
    .eq("id", input.batchId)
    .maybeSingle();
  if (batch.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load the static timetable import.",
      batch.error,
    );
  }
  if (!batch.data) {
    throw new StaticTimetableImportError(
      "STATIC_IMPORT_NOT_FOUND",
      "Static timetable import not found.",
      404,
    );
  }

  const source = await supabase
    .from("source_documents")
    .select("institution_id")
    .eq("id", String(asRecord(batch.data).source_document_id))
    .maybeSingle();
  if (source.error || !source.data) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load the source institution.",
      source.error,
    );
  }
  const institutionId = String(asRecord(source.data).institution_id);

  const target = await supabase
    .from("import_targets")
    .select("id,import_batch_id")
    .eq("id", input.targetId)
    .eq("import_batch_id", input.batchId)
    .maybeSingle();
  if (target.error) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load the detected timetable target.",
      target.error,
    );
  }
  if (!target.data) {
    throw new StaticTimetableImportError(
      "STATIC_IMPORT_TARGET_NOT_FOUND",
      "The detected timetable target does not belong to this import.",
      404,
    );
  }

  if (input.programmeId) {
    const programme = await supabase
      .from("programmes")
      .select("id,institution_id")
      .eq("id", input.programmeId)
      .maybeSingle();
    if (
      programme.error ||
      !programme.data ||
      String(asRecord(programme.data).institution_id) !== institutionId
    ) {
      throw new StaticTimetableImportError(
        "STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH",
        "Programme must belong to the source institution.",
        422,
      );
    }
  }

  if (input.cohortId) {
    if (!input.programmeId) {
      throw new StaticTimetableImportError(
        "STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH",
        "Choose a programme before choosing a class.",
        422,
      );
    }
    const cohort = await supabase
      .from("cohorts")
      .select("id,programme_id")
      .eq("id", input.cohortId)
      .maybeSingle();
    if (
      cohort.error ||
      !cohort.data ||
      String(asRecord(cohort.data).programme_id) !== input.programmeId
    ) {
      throw new StaticTimetableImportError(
        "STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH",
        "Class must belong to the selected programme.",
        422,
      );
    }
  }

  if (input.academicPeriodId) {
    const period = await supabase
      .from("academic_periods")
      .select("id,institution_id")
      .eq("id", input.academicPeriodId)
      .maybeSingle();
    if (
      period.error ||
      !period.data ||
      String(asRecord(period.data).institution_id) !== institutionId
    ) {
      throw new StaticTimetableImportError(
        "STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH",
        "Academic period must belong to the source institution.",
        422,
      );
    }
  }

  const updated = await supabase
    .from("import_targets")
    .update({
      matched_programme_id: input.programmeId,
      matched_cohort_id: input.cohortId,
      matched_academic_period_id: input.academicPeriodId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.targetId)
    .eq("import_batch_id", input.batchId)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data) {
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not persist the canonical timetable mapping.",
      updated.error,
    );
  }

  return getStaticTimetableImport(input.batchId, env);
}

export async function createStaticTimetableDraft(
  input: {
    batchId: string;
    targetId?: string | null;
    actorId: string;
    programmeId: string;
    cohortId: string;
    academicPeriodId: string;
    resolutions: Array<{ warningId: string; note: string }>;
    sessions: Array<Record<string, unknown>>;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const supabase = client(env);
  let targetId = input.targetId ?? null;
  if (!targetId) {
    const targets = await supabase
      .from("import_targets")
      .select("id")
      .eq("import_batch_id", input.batchId);
    const missingTargetTable =
      targets.error && (targets.error as SupabaseErrorLike).code === "42P01";
    if (targets.error && !missingTargetTable) {
      dbError(
        "STATIC_IMPORT_DATABASE_UNAVAILABLE",
        "Could not inspect static timetable import targets.",
        targets.error,
      );
    }
    const rows = missingTargetTable
      ? []
      : ((targets.data ?? []) as unknown as JsonRecord[]);
    if (rows.length === 1) targetId = String(rows[0].id);
  }

  const rpcName = targetId
    ? "materialize_static_document_target_draft"
    : "materialize_static_document_draft";
  const rpcInput = targetId
    ? {
        p_import_target_id: targetId,
        p_actor_id: input.actorId,
        p_programme_id: input.programmeId,
        p_cohort_id: input.cohortId,
        p_academic_period_id: input.academicPeriodId,
        p_resolutions: input.resolutions,
        p_sessions: input.sessions,
      }
    : {
        p_import_batch_id: input.batchId,
        p_actor_id: input.actorId,
        p_programme_id: input.programmeId,
        p_cohort_id: input.cohortId,
        p_academic_period_id: input.academicPeriodId,
        p_resolutions: input.resolutions,
        p_sessions: input.sessions,
      };
  const { data, error } = await supabase.rpc(rpcName, rpcInput);
  if (error) {
    const message = String((error as SupabaseErrorLike).message ?? "");
    const known = [
      "STATIC_IMPORT_ACTOR_REQUIRED",
      "STATIC_IMPORT_SESSIONS_REQUIRED",
      "STATIC_IMPORT_BLOCKERS_UNRESOLVED",
      "STATIC_IMPORT_SESSION_INVALID",
      "STATIC_IMPORT_DUPLICATE_CANDIDATE",
      "STATIC_IMPORT_DUPLICATE_SESSION",
      "STATIC_IMPORT_TIMETABLE_CONFLICT",
      "STATIC_IMPORT_CANONICAL_MAPPING_NOT_FOUND",
      "STATIC_IMPORT_CANONICAL_MAPPING_MISMATCH",
      "STATIC_IMPORT_ACADEMIC_PERIOD_DATES_REQUIRED",
      "STATIC_IMPORT_EXISTING_PUBLISHED_REQUIRES_RECONCILIATION",
    ].find((code) => message.includes(code));
    throw new StaticTimetableImportError(
      known ?? "STATIC_IMPORT_DRAFT_FAILED",
      known
        ? `Static timetable draft stopped safely: ${known}.`
        : "Could not create the reviewed static timetable draft.",
      known ? 409 : 503,
      error,
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new StaticTimetableImportError(
      "STATIC_IMPORT_DRAFT_RESULT_MISSING",
      "Static timetable draft creation returned no result.",
      503,
    );
  }
  const record = asRecord(row);
  return {
    timetableId: String(record.timetable_id),
    draftVersionId: String(record.draft_version_id),
    publicSlug: String(record.public_slug),
    sessionCount: Number(record.session_count),
    status: String(record.status),
  };
}
