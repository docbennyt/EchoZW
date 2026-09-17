import { createHash } from "node:crypto";
import {
  parseStaticTimetableDocument,
  STATIC_TIMETABLE_DOCX_PARSER_VERSION,
  type StaticTimetableParseResult,
} from "../src/domain/staticTimetableDocument.js";
import { readStructuredDocx } from "./docxStructuredReader.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

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

function safeFilename(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
  return cleaned || "timetable.docx";
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
  return String(value ?? "").trim().toLocaleLowerCase("en");
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
  if (institutionError)
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load institutions for static timetable import.",
      institutionError,
    );

  if (!institutionId) {
    return { institutions: institutions ?? [], programmes: [], cohorts: [], academicPeriods: [] };
  }

  const [{ data: programmes, error: programmeError }, { data: periods, error: periodError }] =
    await Promise.all([
      supabase
        .from("programmes")
        .select("id,institution_id,name,short_name,code,academic_unit_id,status")
        .eq("institution_id", institutionId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("academic_periods")
        .select("id,institution_id,name,academic_year,period_number,starts_on,ends_on,status")
        .eq("institution_id", institutionId)
        .order("academic_year", { ascending: false })
        .order("period_number"),
    ]);
  if (programmeError)
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load programmes for static timetable import.",
      programmeError,
    );
  if (periodError)
    dbError(
      "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
      "Could not load academic periods for static timetable import.",
      periodError,
    );

  const programmeIds = (programmes ?? []).map((row) => String(asRecord(row).id));
  let cohorts: unknown[] = [];
  if (programmeIds.length > 0) {
    const { data, error } = await supabase
      .from("cohorts")
      .select("id,programme_id,code,label,level_label,intake_label,group_label,status")
      .in("programme_id", programmeIds)
      .eq("status", "active")
      .order("label");
    if (error)
      dbError(
        "STATIC_IMPORT_OPTIONS_UNAVAILABLE",
        "Could not load cohorts for static timetable import.",
        error,
      );
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
  const programmes = (options.programmes as JsonRecord[]).filter((programme) => {
    const values = [programme.name, programme.short_name, programme.code]
      .map(normalizeText)
      .filter(Boolean);
    return department !== "" && values.includes(department);
  });
  const programmeId = programmes.length === 1 ? String(programmes[0].id) : null;

  const expectedLevel = parsed.metadata.yearLevel;
  const cohorts = (options.cohorts as JsonRecord[]).filter((cohort) => {
    if (!programmeId || String(cohort.programme_id) !== programmeId) return false;
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

  const periods = (options.academicPeriods as JsonRecord[]).filter(
    (period) =>
      String(period.academic_year) === String(parsed.metadata.academicYear ?? "") &&
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

  let parsed: StaticTimetableParseResult;
  try {
    parsed = parseStaticTimetableDocument(readStructuredDocx(input.bytes));
  } catch (error) {
    throw new StaticTimetableImportError(
      "DOCX_PARSE_FAILED",
      "CalenderZW could not safely interpret this DOCX timetable. The file was not imported.",
      422,
      error instanceof Error ? { parserError: error.message } : undefined,
    );
  }

  const supabase = client(env);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storagePath = `${input.institutionId}/${sha256}/${safeFilename(input.filename)}`;

  let { data: sourceDocument, error: sourceLookupError } = await supabase
    .from("source_documents")
    .select("*")
    .eq("institution_id", input.institutionId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (sourceLookupError)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check existing static timetable evidence.",
      sourceLookupError,
    );

  if (!sourceDocument) {
    const upload = await supabase.storage
      .from("timetable-sources")
      .upload(storagePath, input.bytes, {
        contentType:
          input.mimeType ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });
    if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists")) {
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
        mime_type:
          input.mimeType ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size_bytes: input.bytes.length,
        sha256,
        document_type: "cohort_timetable_docx",
        source_status: "parsing",
        uploaded_by: input.actorId,
        parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
        metadata: { parsedMetadata: parsed.metadata },
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
        if (concurrent.error || !concurrent.data)
          dbError(
            "STATIC_IMPORT_DATABASE_UNAVAILABLE",
            "The static timetable source was stored concurrently but could not be loaded.",
            concurrent.error,
          );
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
  const existingBatch = await supabase
    .from("import_batches")
    .select("id")
    .eq("source_document_id", documentId)
    .eq("import_mode", "cohort_docx")
    .eq("parser_version", STATIC_TIMETABLE_DOCX_PARSER_VERSION)
    .maybeSingle();
  if (existingBatch.error)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check an existing static timetable parse run.",
      existingBatch.error,
    );
  if (existingBatch.data) {
    return getStaticTimetableImport(String(asRecord(existingBatch.data).id), env);
  }

  const suggestions = await inferCanonicalSuggestions(input.institutionId, parsed, env);
  const insertedBatch = await supabase
    .from("import_batches")
    .insert({
      source_document_id: documentId,
      import_mode: "cohort_docx",
      status: "review_required",
      parser_version: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
      started_by: input.actorId,
      summary: { ...parserSummaryPayload(parsed), suggestions },
    })
    .select("id")
    .single();
  if (insertedBatch.error || !insertedBatch.data)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not create the static timetable review batch.",
      insertedBatch.error,
    );
  const batchId = String(asRecord(insertedBatch.data).id);

  const documentCandidateKey = `document:${sha256}`;
  const candidateRows = [
    {
      import_batch_id: batchId,
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
      import_batch_id: batchId,
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
      import_batch_id: batchId,
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
      review_status: session.warningCodes.some((code) => code === "COURSE_NOT_IN_REFERENCE")
        ? "invalid"
        : session.warningCodes.length
          ? "warning"
          : "valid",
      normalized_payload: session,
    })),
    ...parsed.unparsed.map((candidate) => ({
      import_batch_id: batchId,
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
    ...parsed.ignored.map((record, index) => ({
      import_batch_id: batchId,
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

  const insertedCandidates = await supabase
    .from("import_candidates")
    .insert(candidateRows)
    .select("id,candidate_key");
  if (insertedCandidates.error || !insertedCandidates.data)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not persist timetable candidates and provenance.",
      insertedCandidates.error,
    );
  const candidateIds = new Map(
    (insertedCandidates.data as unknown as JsonRecord[]).map((row) => [
      String(row.candidate_key),
      String(row.id),
    ]),
  );

  const warningRows = parsed.warnings.map((warning) => ({
    candidate_id:
      candidateIds.get(warning.candidateKey ?? documentCandidateKey) ??
      candidateIds.get(documentCandidateKey),
    warning_code: warning.code,
    severity: warning.severity === "error" ? "blocking" : "warning",
    message: warning.message,
    field_name: warning.fieldName,
    suggested_value: null,
  }));
  if (warningRows.length > 0) {
    const { error } = await supabase.from("import_candidate_warnings").insert(warningRows);
    if (error)
      dbError(
        "STATIC_IMPORT_DATABASE_UNAVAILABLE",
        "Could not persist static timetable review warnings.",
        error,
      );
  }

  const { error: documentUpdateError } = await supabase
    .from("source_documents")
    .update({ source_status: "review_required" })
    .eq("id", documentId);
  if (documentUpdateError)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not finalize the static timetable source status.",
      documentUpdateError,
    );

  return getStaticTimetableImport(batchId, env);
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
  if (batchQuery.error)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load the static timetable import review.",
      batchQuery.error,
    );
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
  if (documentQuery.error || !documentQuery.data)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load static timetable source evidence.",
      documentQuery.error,
    );

  const candidatesQuery = await supabase
    .from("import_candidates")
    .select("id,candidate_key")
    .eq("import_batch_id", batchId);
  if (candidatesQuery.error)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not load static timetable candidate evidence.",
      candidatesQuery.error,
    );
  const candidateRows = (candidatesQuery.data ?? []) as unknown as JsonRecord[];
  const candidateKeys = new Map(
    candidateRows.map((row) => [String(row.id), row.candidate_key ? String(row.candidate_key) : null]),
  );
  let warningRows: JsonRecord[] = [];
  if (candidateRows.length > 0) {
    const warningsQuery = await supabase
      .from("import_candidate_warnings")
      .select("id,candidate_id,warning_code,severity,message,field_name,resolution_note,resolved_at")
      .in(
        "candidate_id",
        candidateRows.map((row) => String(row.id)),
      )
      .order("created_at");
    if (warningsQuery.error)
      dbError(
        "STATIC_IMPORT_DATABASE_UNAVAILABLE",
        "Could not load static timetable warnings.",
        warningsQuery.error,
      );
    warningRows = (warningsQuery.data ?? []) as unknown as JsonRecord[];
  }

  const summary = asRecord(batch.summary ?? {});
  const parsedSummary = asRecord(summary.summary ?? {});
  const document = asRecord(documentQuery.data);
  const versionQuery = await supabase
    .from("timetable_versions")
    .select("id,timetable_id")
    .eq("import_batch_id", batchId)
    .maybeSingle();
  if (versionQuery.error)
    dbError(
      "STATIC_IMPORT_DATABASE_UNAVAILABLE",
      "Could not check the created static timetable draft.",
      versionQuery.error,
    );

  let createdDraft: null | Record<string, unknown> = null;
  if (versionQuery.data) {
    const version = asRecord(versionQuery.data);
    const timetable = await supabase
      .from("timetables")
      .select("public_slug")
      .eq("id", String(version.timetable_id))
      .maybeSingle();
    const count = await supabase
      .from("timetable_sessions")
      .select("id", { count: "exact", head: true })
      .eq("timetable_version_id", String(version.id));
    createdDraft = {
      timetableId: String(version.timetable_id),
      draftVersionId: String(version.id),
      publicSlug: timetable.data ? String(asRecord(timetable.data).public_slug ?? "") : "",
      sessionCount: count.count ?? 0,
    };
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
    suggestions: asRecord(summary.suggestions ?? {}),
    createdDraft,
  };
}

export async function createStaticTimetableDraft(
  input: {
    batchId: string;
    actorId: string;
    programmeId: string;
    cohortId: string;
    academicPeriodId: string;
    resolutions: Array<{ warningId: string; note: string }>;
    sessions: Array<Record<string, unknown>>;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const { data, error } = await client(env).rpc("materialize_static_document_draft", {
    p_import_batch_id: input.batchId,
    p_actor_id: input.actorId,
    p_programme_id: input.programmeId,
    p_cohort_id: input.cohortId,
    p_academic_period_id: input.academicPeriodId,
    p_resolutions: input.resolutions,
    p_sessions: input.sessions,
  });
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
