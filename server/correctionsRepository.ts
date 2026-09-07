import type {
  TimetableCorrectionDirective,
  TimetableMutationOutcome,
  TimetableSessionException,
} from "../src/api/pilotTypes.js";
import { PilotApiError } from "./pilotRepository.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type { StaffAuthContext } from "./supabase/auth.js";

type JsonRecord = Record<string, unknown>;
type QueryError = { code?: string; message?: string; details?: string } | null;

type MutationResult<T> = {
  item: T;
  mutationOutcome: TimetableMutationOutcome;
};

type CorrectionWrite = {
  timetableId: string;
  actor: StaffAuthContext;
  mutationKey: string;
  stableSessionKey?: string | null;
  action: "add" | "modify" | "remove";
  sourceMayReplace: boolean;
  courseCode?: string | null;
  courseName?: string | null;
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
  reason: string;
  provenance?: string | null;
};

type ExceptionWrite = {
  timetableId: string;
  actor: StaffAuthContext;
  mutationKey: string;
  stableSessionKey?: string | null;
  exceptionDate: string;
  exceptionType: "cancelled" | "moved" | "extra";
  replacementStartsAt?: string | null;
  replacementEndsAt?: string | null;
  courseCode?: string | null;
  courseName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
  reason: string;
  provenance?: string | null;
};

let repositoryEnv: NodeJS.ProcessEnv | undefined;

export function setCorrectionsRepositoryEnv(env: NodeJS.ProcessEnv) {
  repositoryEnv = env;
}

function client() {
  return createSupabaseAdminClient(repositoryEnv ?? process.env);
}

function requireText(value: string | null | undefined, message: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw new PilotApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function maybeText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new PilotApiError("VALIDATION_ERROR", "Enter a valid time.", 422);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new PilotApiError("VALIDATION_ERROR", "Enter a valid time.", 422);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function assertTimeRange(startTime: string, endTime: string) {
  if (normalizeTime(endTime) <= normalizeTime(startTime)) {
    throw new PilotApiError(
      "INVALID_TIME_RANGE",
      "Class end time must be after the start time.",
      422,
    );
  }
}

function mapCorrection(row: JsonRecord): TimetableCorrectionDirective {
  const sourceMayReplace = Boolean(row.source_may_replace);
  return {
    id: String(row.id),
    stableSessionKey: row.stable_session_key
      ? String(row.stable_session_key)
      : null,
    action: row.action as TimetableCorrectionDirective["action"],
    sourceMayReplace,
    pinned: !sourceMayReplace,
    courseCode: row.course_code ? String(row.course_code) : null,
    courseName: row.course_name ? String(row.course_name) : null,
    weekday:
      row.weekday === null || row.weekday === undefined
        ? null
        : Number(row.weekday),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    venue: row.venue ? String(row.venue) : null,
    lecturer: row.lecturer ? String(row.lecturer) : null,
    sessionType: row.session_type ? String(row.session_type) : null,
    notes: row.notes ? String(row.notes) : null,
    reason: String(row.reason),
    provenance: row.provenance ? String(row.provenance) : null,
    creatorRole:
      row.creator_role as TimetableCorrectionDirective["creatorRole"],
    active: Boolean(row.active),
    mutationKey: row.mutation_key ? String(row.mutation_key) : null,
    semanticFingerprint: row.semantic_fingerprint
      ? String(row.semantic_fingerprint)
      : null,
    revision: Number(row.revision ?? 1),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    replacedById: row.replaced_by_id ? String(row.replaced_by_id) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    supersededAt: row.superseded_at ? String(row.superseded_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function mapException(row: JsonRecord): TimetableSessionException {
  return {
    id: String(row.id),
    stableSessionKey: row.stable_session_key
      ? String(row.stable_session_key)
      : null,
    exceptionDate: String(row.exception_date),
    exceptionType:
      row.exception_type as TimetableSessionException["exceptionType"],
    replacementStartsAt: row.replacement_starts_at
      ? String(row.replacement_starts_at)
      : null,
    replacementEndsAt: row.replacement_ends_at
      ? String(row.replacement_ends_at)
      : null,
    courseCode: row.course_code ? String(row.course_code) : null,
    courseName: row.course_name ? String(row.course_name) : null,
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    venue: row.venue ? String(row.venue) : null,
    lecturer: row.lecturer ? String(row.lecturer) : null,
    sessionType: row.session_type ? String(row.session_type) : null,
    notes: row.notes ? String(row.notes) : null,
    reason: row.reason ? String(row.reason) : null,
    provenance: row.provenance ? String(row.provenance) : null,
    creatorRole: row.creator_role as TimetableSessionException["creatorRole"],
    active: Boolean(row.active),
    mutationKey: row.mutation_key ? String(row.mutation_key) : null,
    semanticFingerprint: row.semantic_fingerprint
      ? String(row.semantic_fingerprint)
      : null,
    revision: Number(row.revision ?? 1),
    supersedesId: row.supersedes_id ? String(row.supersedes_id) : null,
    replacedById: row.replaced_by_id ? String(row.replaced_by_id) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    supersededAt: row.superseded_at ? String(row.superseded_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

async function expectData<T>(
  query: PromiseLike<{ data: T | null; error: QueryError }>,
  code: string,
  message: string,
) {
  const { data, error } = await query;
  if (error) throw new PilotApiError(code, message, 503, error);
  return data;
}

function isUniqueConflict(error: QueryError) {
  const message = error?.message ?? "";
  return (
    error?.code === "23505" ||
    message.includes("TIMETABLE_UPDATE_ALREADY_EXISTS") ||
    message.toLowerCase().includes("duplicate key")
  );
}

function isStaleEdit(error: QueryError) {
  const message = error?.message ?? "";
  return (
    error?.code === "40001" ||
    message.includes("CORRECTION_STALE_EDIT") ||
    message.includes("EXCEPTION_STALE_EDIT")
  );
}

async function audit(input: {
  actor: StaffAuthContext;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: JsonRecord;
}) {
  const { error } = await client().from("audit_logs").insert({
    actor_id: input.actor.user.id,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: {
      staffUserId: input.actor.staff.id,
      staffRole: input.actor.staff.role,
      ...(input.metadata ?? {}),
    },
  });
  if (error) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not record the timetable correction audit log.",
      503,
      error,
    );
  }
}

async function fingerprintCorrection(payload: JsonRecord) {
  const fingerprint = await expectData<string>(
    client().rpc("timetable_correction_semantic_fingerprint", {
      p_payload: payload,
    }),
    "DATABASE_UNAVAILABLE",
    "Could not verify the correction identity.",
  );
  if (!fingerprint) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not verify the correction identity.",
      503,
    );
  }
  return fingerprint;
}

async function fingerprintException(payload: JsonRecord) {
  const fingerprint = await expectData<string>(
    client().rpc("timetable_exception_semantic_fingerprint", {
      p_payload: payload,
    }),
    "DATABASE_UNAVAILABLE",
    "Could not verify the timetable update identity.",
  );
  if (!fingerprint) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not verify the timetable update identity.",
      503,
    );
  }
  return fingerprint;
}

async function findCorrectionByMutationKey(input: {
  timetableId: string;
  staffUserId: string;
  mutationKey: string;
}) {
  return expectData<JsonRecord>(
    client()
      .from("timetable_correction_directives")
      .select("*")
      .eq("timetable_id", input.timetableId)
      .eq("creator_staff_user_id", input.staffUserId)
      .eq("mutation_key", input.mutationKey)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not verify whether this correction was already saved.",
  );
}

async function findExceptionByMutationKey(input: {
  timetableId: string;
  staffUserId: string;
  mutationKey: string;
}) {
  return expectData<JsonRecord>(
    client()
      .from("timetable_session_exceptions")
      .select("*")
      .eq("timetable_id", input.timetableId)
      .eq("creator_staff_user_id", input.staffUserId)
      .eq("mutation_key", input.mutationKey)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not verify whether this class update was already saved.",
  );
}

async function findActiveCorrectionByFingerprint(
  timetableId: string,
  semanticFingerprint: string,
) {
  const rows = await expectData<JsonRecord[]>(
    client()
      .from("timetable_correction_directives")
      .select("*")
      .eq("timetable_id", timetableId)
      .eq("semantic_fingerprint", semanticFingerprint)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1),
    "DATABASE_UNAVAILABLE",
    "Could not check for an existing correction.",
  );
  return rows?.[0] ?? null;
}

async function findActiveExceptionByFingerprint(
  timetableId: string,
  semanticFingerprint: string,
) {
  const rows = await expectData<JsonRecord[]>(
    client()
      .from("timetable_session_exceptions")
      .select("*")
      .eq("timetable_id", timetableId)
      .eq("semantic_fingerprint", semanticFingerprint)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1),
    "DATABASE_UNAVAILABLE",
    "Could not check for an existing class update.",
  );
  return rows?.[0] ?? null;
}

async function getCorrectionRow(timetableId: string, correctionId: string) {
  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_correction_directives")
      .select("*")
      .eq("id", correctionId)
      .eq("timetable_id", timetableId)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the recurring correction.",
  );
  if (!row) {
    throw new PilotApiError("CORRECTION_NOT_FOUND", "Correction not found.", 404);
  }
  return row;
}

async function getExceptionRow(timetableId: string, exceptionId: string) {
  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_session_exceptions")
      .select("*")
      .eq("id", exceptionId)
      .eq("timetable_id", timetableId)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the timetable exception.",
  );
  if (!row) {
    throw new PilotApiError("EXCEPTION_NOT_FOUND", "Class update not found.", 404);
  }
  return row;
}

function correctionPayload(input: CorrectionWrite) {
  const payload: JsonRecord = {
    timetable_id: input.timetableId,
    stable_session_key: maybeText(input.stableSessionKey),
    action: input.action,
    source_may_replace: input.sourceMayReplace,
    reason: requireText(input.reason, "Reason is required."),
    provenance: maybeText(input.provenance),
    creator_role: input.actor.staff.role,
    creator_user_id: input.actor.user.id,
    creator_staff_user_id: input.actor.staff.id,
    mutation_key: input.mutationKey,
    active: true,
  };

  if (input.action !== "remove") {
    const startTime = normalizeTime(
      requireText(input.startTime, "Start time is required."),
    );
    const endTime = normalizeTime(
      requireText(input.endTime, "End time is required."),
    );
    assertTimeRange(startTime, endTime);
    if (!input.weekday || input.weekday < 1 || input.weekday > 7) {
      throw new PilotApiError("VALIDATION_ERROR", "Choose a weekday.", 422);
    }
    payload.course_code = requireText(
      input.courseCode,
      "Course code is required.",
    );
    payload.course_name = requireText(
      input.courseName,
      "Course name is required.",
    );
    payload.weekday = input.weekday;
    payload.start_time = startTime;
    payload.end_time = endTime;
    payload.venue = maybeText(input.venue);
    payload.lecturer = maybeText(input.lecturer);
    payload.session_type = maybeText(input.sessionType);
    payload.notes = maybeText(input.notes);
  }
  return payload;
}

function exceptionPayload(input: ExceptionWrite) {
  const payload: JsonRecord = {
    timetable_id: input.timetableId,
    stable_session_key: maybeText(input.stableSessionKey),
    exception_date: requireText(input.exceptionDate, "Date is required."),
    exception_type: input.exceptionType,
    notes: maybeText(input.notes),
    reason: requireText(input.reason, "Reason is required."),
    provenance: maybeText(input.provenance),
    active: true,
    creator_role: input.actor.staff.role,
    creator_user_id: input.actor.user.id,
    creator_staff_user_id: input.actor.staff.id,
    mutation_key: input.mutationKey,
  };

  if (input.exceptionType === "extra") {
    const startTime = normalizeTime(
      requireText(input.startTime, "Start time is required."),
    );
    const endTime = normalizeTime(
      requireText(input.endTime, "End time is required."),
    );
    assertTimeRange(startTime, endTime);
    payload.course_code = requireText(
      input.courseCode,
      "Course code is required.",
    );
    payload.course_name = requireText(
      input.courseName,
      "Course name is required.",
    );
    payload.start_time = startTime;
    payload.end_time = endTime;
    payload.venue = maybeText(input.venue);
    payload.lecturer = maybeText(input.lecturer);
    payload.session_type = maybeText(input.sessionType);
  }

  if (input.exceptionType === "moved") {
    payload.replacement_starts_at = requireText(
      input.replacementStartsAt,
      "Replacement start is required.",
    );
    payload.replacement_ends_at = requireText(
      input.replacementEndsAt,
      "Replacement end is required.",
    );
  }
  return payload;
}

export async function listTimetableCorrections(timetableId: string) {
  const admin = client();
  const [corrections, exceptions] = await Promise.all([
    expectData<JsonRecord[]>(
      admin
        .from("timetable_correction_directives")
        .select("*")
        .eq("timetable_id", timetableId)
        .eq("active", true)
        .order("created_at", { ascending: false }),
      "DATABASE_UNAVAILABLE",
      "Could not load timetable corrections.",
    ),
    expectData<JsonRecord[]>(
      admin
        .from("timetable_session_exceptions")
        .select("*")
        .eq("timetable_id", timetableId)
        .eq("active", true)
        .order("exception_date")
        .order("start_time"),
      "DATABASE_UNAVAILABLE",
      "Could not load timetable exceptions.",
    ),
  ]);
  return {
    corrections: (corrections ?? []).map(mapCorrection),
    exceptions: (exceptions ?? []).map(mapException),
  };
}

async function recordReplay(input: {
  actor: StaffAuthContext;
  timetableId: string;
  entityType: string;
  entityId: string;
  action: string;
  edit?: boolean;
  concurrent?: boolean;
}) {
  await audit({
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: {
      timetableId: input.timetableId,
      ...(input.edit ? { edit: true } : {}),
      ...(input.concurrent ? { concurrent: true } : {}),
    },
  });
}

export async function createRecurringCorrection(
  input: CorrectionWrite,
): Promise<MutationResult<TimetableCorrectionDirective>> {
  const payload = correctionPayload(input);
  const semanticFingerprint = await fingerprintCorrection(payload);
  payload.semantic_fingerprint = semanticFingerprint;

  const replay = await findCorrectionByMutationKey({
    timetableId: input.timetableId,
    staffUserId: input.actor.staff.id,
    mutationKey: input.mutationKey,
  });
  if (replay) {
    if (String(replay.semantic_fingerprint) !== semanticFingerprint) {
      throw new PilotApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This save attempt no longer matches the original update. Start a new save.",
        409,
      );
    }
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_correction_directive",
      entityId: String(replay.id),
      action: "timetable_correction.idempotency_replayed",
    });
    return { item: mapCorrection(replay), mutationOutcome: "replayed" };
  }

  const duplicate = await findActiveCorrectionByFingerprint(
    input.timetableId,
    semanticFingerprint,
  );
  if (duplicate) {
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_correction_directive",
      entityId: String(duplicate.id),
      action: "timetable_correction.semantic_duplicate_prevented",
    });
    return { item: mapCorrection(duplicate), mutationOutcome: "already_exists" };
  }

  const { data, error } = await client()
    .from("timetable_correction_directives")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    if (isUniqueConflict(error)) {
      const racedReplay = await findCorrectionByMutationKey({
        timetableId: input.timetableId,
        staffUserId: input.actor.staff.id,
        mutationKey: input.mutationKey,
      });
      if (racedReplay) {
        if (String(racedReplay.semantic_fingerprint) !== semanticFingerprint) {
          throw new PilotApiError(
            "IDEMPOTENCY_KEY_REUSED",
            "This save attempt no longer matches the original update. Start a new save.",
            409,
          );
        }
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_correction_directive",
          entityId: String(racedReplay.id),
          action: "timetable_correction.idempotency_replayed",
          concurrent: true,
        });
        return { item: mapCorrection(racedReplay), mutationOutcome: "replayed" };
      }
      const racedDuplicate = await findActiveCorrectionByFingerprint(
        input.timetableId,
        semanticFingerprint,
      );
      if (racedDuplicate) {
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_correction_directive",
          entityId: String(racedDuplicate.id),
          action: "timetable_correction.semantic_duplicate_prevented",
          concurrent: true,
        });
        return {
          item: mapCorrection(racedDuplicate),
          mutationOutcome: "already_exists",
        };
      }
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not save the recurring correction.",
      503,
      error,
    );
  }

  await audit({
    actor: input.actor,
    action: "timetable_correction.created",
    entityType: "timetable_correction_directive",
    entityId: String(data.id),
    metadata: {
      timetableId: input.timetableId,
      correctionAction: input.action,
      sourceMayReplace: input.sourceMayReplace,
    },
  });
  return { item: mapCorrection(data), mutationOutcome: "created" };
}

export async function createSessionException(
  input: ExceptionWrite,
): Promise<MutationResult<TimetableSessionException>> {
  const payload = exceptionPayload(input);
  const semanticFingerprint = await fingerprintException(payload);
  payload.semantic_fingerprint = semanticFingerprint;

  const replay = await findExceptionByMutationKey({
    timetableId: input.timetableId,
    staffUserId: input.actor.staff.id,
    mutationKey: input.mutationKey,
  });
  if (replay) {
    if (String(replay.semantic_fingerprint) !== semanticFingerprint) {
      throw new PilotApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This save attempt no longer matches the original update. Start a new save.",
        409,
      );
    }
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_session_exception",
      entityId: String(replay.id),
      action: "timetable_exception.idempotency_replayed",
    });
    return { item: mapException(replay), mutationOutcome: "replayed" };
  }

  const duplicate = await findActiveExceptionByFingerprint(
    input.timetableId,
    semanticFingerprint,
  );
  if (duplicate) {
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_session_exception",
      entityId: String(duplicate.id),
      action: "timetable_exception.semantic_duplicate_prevented",
    });
    return { item: mapException(duplicate), mutationOutcome: "already_exists" };
  }

  const { data, error } = await client()
    .from("timetable_session_exceptions")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    if (isUniqueConflict(error)) {
      const racedReplay = await findExceptionByMutationKey({
        timetableId: input.timetableId,
        staffUserId: input.actor.staff.id,
        mutationKey: input.mutationKey,
      });
      if (racedReplay) {
        if (String(racedReplay.semantic_fingerprint) !== semanticFingerprint) {
          throw new PilotApiError(
            "IDEMPOTENCY_KEY_REUSED",
            "This save attempt no longer matches the original update. Start a new save.",
            409,
          );
        }
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_session_exception",
          entityId: String(racedReplay.id),
          action: "timetable_exception.idempotency_replayed",
          concurrent: true,
        });
        return { item: mapException(racedReplay), mutationOutcome: "replayed" };
      }
      const racedDuplicate = await findActiveExceptionByFingerprint(
        input.timetableId,
        semanticFingerprint,
      );
      if (racedDuplicate) {
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_session_exception",
          entityId: String(racedDuplicate.id),
          action: "timetable_exception.semantic_duplicate_prevented",
          concurrent: true,
        });
        return {
          item: mapException(racedDuplicate),
          mutationOutcome: "already_exists",
        };
      }
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not save the timetable exception.",
      503,
      error,
    );
  }

  await audit({
    actor: input.actor,
    action: "timetable_exception.created",
    entityType: "timetable_session_exception",
    entityId: String(data.id),
    metadata: {
      timetableId: input.timetableId,
      exceptionType: input.exceptionType,
    },
  });
  return { item: mapException(data), mutationOutcome: "created" };
}

export async function replaceRecurringCorrection(
  input: CorrectionWrite & {
    correctionId: string;
    expectedUpdatedAt: string;
  },
): Promise<MutationResult<TimetableCorrectionDirective>> {
  const payload = correctionPayload(input);
  const semanticFingerprint = await fingerprintCorrection(payload);
  payload.semantic_fingerprint = semanticFingerprint;

  const replay = await findCorrectionByMutationKey({
    timetableId: input.timetableId,
    staffUserId: input.actor.staff.id,
    mutationKey: input.mutationKey,
  });
  if (replay) {
    if (
      String(replay.semantic_fingerprint) !== semanticFingerprint ||
      String(replay.supersedes_id ?? "") !== input.correctionId
    ) {
      throw new PilotApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This edit attempt no longer matches the original update. Start a new edit.",
        409,
      );
    }
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_correction_directive",
      entityId: String(replay.id),
      action: "timetable_correction.idempotency_replayed",
      edit: true,
    });
    return { item: mapCorrection(replay), mutationOutcome: "replayed" };
  }

  const { data, error } = await client().rpc(
    "replace_timetable_correction_update",
    {
      p_timetable_id: input.timetableId,
      p_correction_id: input.correctionId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor_user_id: input.actor.user.id,
      p_actor_staff_user_id: input.actor.staff.id,
      p_actor_role: input.actor.staff.role,
      p_mutation_key: input.mutationKey,
      p_payload: payload,
    },
  );
  if (error) {
    if (isStaleEdit(error)) {
      throw new PilotApiError(
        "STALE_CORRECTION_EDIT",
        "This update changed since you opened it. Refresh and review the newer version before editing.",
        409,
        error,
      );
    }
    if (isUniqueConflict(error)) {
      const duplicate = await findActiveCorrectionByFingerprint(
        input.timetableId,
        semanticFingerprint,
      );
      if (duplicate) {
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_correction_directive",
          entityId: String(duplicate.id),
          action: "timetable_correction.semantic_duplicate_prevented",
          edit: true,
        });
        return {
          item: mapCorrection(duplicate),
          mutationOutcome: "already_exists",
        };
      }
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not edit the recurring correction.",
      503,
      error,
    );
  }

  const row = data as JsonRecord;
  await audit({
    actor: input.actor,
    action: "timetable_correction.superseded",
    entityType: "timetable_correction_directive",
    entityId: String(row.id),
    metadata: {
      timetableId: input.timetableId,
      supersedesId: input.correctionId,
    },
  });
  return { item: mapCorrection(row), mutationOutcome: "updated" };
}

export async function replaceSessionException(
  input: ExceptionWrite & {
    exceptionId: string;
    expectedUpdatedAt: string;
  },
): Promise<MutationResult<TimetableSessionException>> {
  const payload = exceptionPayload(input);
  const semanticFingerprint = await fingerprintException(payload);
  payload.semantic_fingerprint = semanticFingerprint;

  const replay = await findExceptionByMutationKey({
    timetableId: input.timetableId,
    staffUserId: input.actor.staff.id,
    mutationKey: input.mutationKey,
  });
  if (replay) {
    if (
      String(replay.semantic_fingerprint) !== semanticFingerprint ||
      String(replay.supersedes_id ?? "") !== input.exceptionId
    ) {
      throw new PilotApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This edit attempt no longer matches the original update. Start a new edit.",
        409,
      );
    }
    await recordReplay({
      actor: input.actor,
      timetableId: input.timetableId,
      entityType: "timetable_session_exception",
      entityId: String(replay.id),
      action: "timetable_exception.idempotency_replayed",
      edit: true,
    });
    return { item: mapException(replay), mutationOutcome: "replayed" };
  }

  const { data, error } = await client().rpc(
    "replace_timetable_exception_update",
    {
      p_timetable_id: input.timetableId,
      p_exception_id: input.exceptionId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor_user_id: input.actor.user.id,
      p_actor_staff_user_id: input.actor.staff.id,
      p_actor_role: input.actor.staff.role,
      p_mutation_key: input.mutationKey,
      p_payload: payload,
    },
  );
  if (error) {
    if (isStaleEdit(error)) {
      throw new PilotApiError(
        "STALE_EXCEPTION_EDIT",
        "This class update changed since you opened it. Refresh and review the newer version before editing.",
        409,
        error,
      );
    }
    if (isUniqueConflict(error)) {
      const duplicate = await findActiveExceptionByFingerprint(
        input.timetableId,
        semanticFingerprint,
      );
      if (duplicate) {
        await recordReplay({
          actor: input.actor,
          timetableId: input.timetableId,
          entityType: "timetable_session_exception",
          entityId: String(duplicate.id),
          action: "timetable_exception.semantic_duplicate_prevented",
          edit: true,
        });
        return {
          item: mapException(duplicate),
          mutationOutcome: "already_exists",
        };
      }
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not edit the class update.",
      503,
      error,
    );
  }

  const row = data as JsonRecord;
  await audit({
    actor: input.actor,
    action: "timetable_exception.superseded",
    entityType: "timetable_session_exception",
    entityId: String(row.id),
    metadata: {
      timetableId: input.timetableId,
      supersedesId: input.exceptionId,
    },
  });
  return { item: mapException(row), mutationOutcome: "updated" };
}

export async function revokeCorrection(input: {
  timetableId: string;
  correctionId: string;
  actor: StaffAuthContext;
}): Promise<MutationResult<TimetableCorrectionDirective>> {
  const existing = await getCorrectionRow(input.timetableId, input.correctionId);
  if (!existing.active) {
    return { item: mapCorrection(existing), mutationOutcome: "replayed" };
  }

  const now = new Date().toISOString();
  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_correction_directives")
      .update({
        active: false,
        revoked_at: now,
        revoked_by: input.actor.user.id,
        updated_at: now,
      })
      .eq("id", input.correctionId)
      .eq("timetable_id", input.timetableId)
      .eq("active", true)
      .select("*")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not revoke the recurring correction.",
  );
  await audit({
    actor: input.actor,
    action: "timetable_correction.revoked",
    entityType: "timetable_correction_directive",
    entityId: input.correctionId,
    metadata: { timetableId: input.timetableId },
  });
  return { item: mapCorrection(row as JsonRecord), mutationOutcome: "revoked" };
}

export async function revokeException(input: {
  timetableId: string;
  exceptionId: string;
  actor: StaffAuthContext;
}): Promise<MutationResult<TimetableSessionException>> {
  const existing = await getExceptionRow(input.timetableId, input.exceptionId);
  if (!existing.active) {
    return { item: mapException(existing), mutationOutcome: "replayed" };
  }

  const now = new Date().toISOString();
  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_session_exceptions")
      .update({
        active: false,
        revoked_at: now,
        revoked_by: input.actor.user.id,
        updated_at: now,
      })
      .eq("id", input.exceptionId)
      .eq("timetable_id", input.timetableId)
      .eq("active", true)
      .select("*")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not revoke the timetable exception.",
  );
  await audit({
    actor: input.actor,
    action: "timetable_exception.revoked",
    entityType: "timetable_session_exception",
    entityId: input.exceptionId,
    metadata: { timetableId: input.timetableId },
  });
  return { item: mapException(row as JsonRecord), mutationOutcome: "revoked" };
}

const UNDO_WINDOW_MS = 10 * 60 * 1000;

function assertUndoable(row: JsonRecord, expectedUpdatedAt: string) {
  if (row.active) {
    throw new PilotApiError(
      "UPDATE_ALREADY_ACTIVE",
      "This timetable update is already active.",
      409,
    );
  }
  if (row.replaced_by_id || row.superseded_at) {
    throw new PilotApiError(
      "UNDO_CONFLICT",
      "This update was replaced by a newer edit and cannot be restored.",
      409,
    );
  }
  if (String(row.updated_at ?? row.created_at) !== expectedUpdatedAt) {
    throw new PilotApiError(
      "UNDO_CONFLICT",
      "This update changed since it was removed. Refresh before restoring it.",
      409,
    );
  }
  const revokedAt = row.revoked_at
    ? new Date(String(row.revoked_at)).getTime()
    : 0;
  if (!revokedAt || Date.now() - revokedAt > UNDO_WINDOW_MS) {
    throw new PilotApiError(
      "UNDO_WINDOW_EXPIRED",
      "The quick undo window has expired. Create a new reviewed update instead.",
      409,
    );
  }
}

export async function restoreCorrection(input: {
  timetableId: string;
  correctionId: string;
  expectedUpdatedAt: string;
  actor: StaffAuthContext;
}): Promise<MutationResult<TimetableCorrectionDirective>> {
  const existing = await getCorrectionRow(input.timetableId, input.correctionId);
  assertUndoable(existing, input.expectedUpdatedAt);
  const now = new Date().toISOString();
  const { data, error } = await client()
    .from("timetable_correction_directives")
    .update({
      active: true,
      revoked_at: null,
      revoked_by: null,
      updated_at: now,
    })
    .eq("id", input.correctionId)
    .eq("timetable_id", input.timetableId)
    .eq("active", false)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*")
    .single();
  if (error) {
    if (isUniqueConflict(error)) {
      throw new PilotApiError(
        "UNDO_CONFLICT",
        "An equivalent timetable update is already active. The removed update was not restored.",
        409,
        error,
      );
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not restore the recurring correction.",
      503,
      error,
    );
  }
  await audit({
    actor: input.actor,
    action: "timetable_correction.restored",
    entityType: "timetable_correction_directive",
    entityId: input.correctionId,
    metadata: { timetableId: input.timetableId },
  });
  return { item: mapCorrection(data), mutationOutcome: "restored" };
}

export async function restoreException(input: {
  timetableId: string;
  exceptionId: string;
  expectedUpdatedAt: string;
  actor: StaffAuthContext;
}): Promise<MutationResult<TimetableSessionException>> {
  const existing = await getExceptionRow(input.timetableId, input.exceptionId);
  assertUndoable(existing, input.expectedUpdatedAt);
  const now = new Date().toISOString();
  const { data, error } = await client()
    .from("timetable_session_exceptions")
    .update({
      active: true,
      revoked_at: null,
      revoked_by: null,
      updated_at: now,
    })
    .eq("id", input.exceptionId)
    .eq("timetable_id", input.timetableId)
    .eq("active", false)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*")
    .single();
  if (error) {
    if (isUniqueConflict(error)) {
      throw new PilotApiError(
        "UNDO_CONFLICT",
        "An equivalent class update is already active. The removed update was not restored.",
        409,
        error,
      );
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not restore the class update.",
      503,
      error,
    );
  }
  await audit({
    actor: input.actor,
    action: "timetable_exception.restored",
    entityType: "timetable_session_exception",
    entityId: input.exceptionId,
    metadata: { timetableId: input.timetableId },
  });
  return { item: mapException(data), mutationOutcome: "restored" };
}

export async function dedupeCorrections(input: {
  timetableId: string;
  semanticFingerprint: string;
  actor: StaffAuthContext;
}) {
  const result = await expectData<{ keptId?: string; revokedCount?: number }>(
    client().rpc("dedupe_timetable_correction_group", {
      p_timetable_id: input.timetableId,
      p_semantic_fingerprint: requireText(
        input.semanticFingerprint,
        "Duplicate group is required.",
      ),
      p_actor_user_id: input.actor.user.id,
    }),
    "DATABASE_UNAVAILABLE",
    "Could not remove duplicate recurring updates.",
  );
  const keptId = result?.keptId ?? null;
  const revokedCount = Number(result?.revokedCount ?? 0);
  await audit({
    actor: input.actor,
    action: "timetable_correction.duplicates_resolved",
    entityType: "timetable_correction_directive",
    entityId: keptId,
    metadata: { timetableId: input.timetableId, revokedCount },
  });
  return { keptId, revokedCount };
}

export async function dedupeExceptions(input: {
  timetableId: string;
  semanticFingerprint: string;
  actor: StaffAuthContext;
}) {
  const result = await expectData<{ keptId?: string; revokedCount?: number }>(
    client().rpc("dedupe_timetable_exception_group", {
      p_timetable_id: input.timetableId,
      p_semantic_fingerprint: requireText(
        input.semanticFingerprint,
        "Duplicate group is required.",
      ),
      p_actor_user_id: input.actor.user.id,
    }),
    "DATABASE_UNAVAILABLE",
    "Could not remove duplicate class updates.",
  );
  const keptId = result?.keptId ?? null;
  const revokedCount = Number(result?.revokedCount ?? 0);
  await audit({
    actor: input.actor,
    action: "timetable_exception.duplicates_resolved",
    entityType: "timetable_session_exception",
    entityId: keptId,
    metadata: { timetableId: input.timetableId, revokedCount },
  });
  return { keptId, revokedCount };
}
