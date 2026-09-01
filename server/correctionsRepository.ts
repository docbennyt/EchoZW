import type {
  TimetableCorrectionDirective,
  TimetableSessionException,
} from "../src/api/pilotTypes.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type { StaffAuthContext } from "./supabase/auth.js";
import { PilotApiError } from "./pilotRepository.js";

type JsonRecord = Record<string, unknown>;

let repositoryEnv: NodeJS.ProcessEnv | undefined;

export function setCorrectionsRepositoryEnv(env: NodeJS.ProcessEnv) {
  repositoryEnv = env;
}

function client() {
  return createSupabaseAdminClient(repositoryEnv ?? process.env);
}

function normalizeTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new PilotApiError("VALIDATION_ERROR", "Enter a valid time.", 422);
  }
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
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

function requireText(value: string | null | undefined, message: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw new PilotApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function maybeText(value: string | null | undefined) {
  return value?.trim() || null;
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
    weekday: row.weekday === null ? null : Number(row.weekday),
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
    createdAt: String(row.created_at),
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
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

async function expectData<T>(
  query: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  code: string,
  message: string,
) {
  const { data, error } = await query;
  if (error) throw new PilotApiError(code, message, 503, error);
  return data;
}

async function audit(input: {
  actor: StaffAuthContext;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: JsonRecord;
}) {
  const { error } = await client()
    .from("audit_logs")
    .insert({
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

export async function createRecurringCorrection(input: {
  timetableId: string;
  actor: StaffAuthContext;
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
}) {
  const reason = requireText(input.reason, "Reason is required.");
  const payload: JsonRecord = {
    timetable_id: input.timetableId,
    stable_session_key: maybeText(input.stableSessionKey),
    action: input.action,
    source_may_replace: input.sourceMayReplace,
    reason,
    provenance: maybeText(input.provenance),
    creator_role: input.actor.staff.role,
    creator_user_id: input.actor.user.id,
    creator_staff_user_id: input.actor.staff.id,
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

  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_correction_directives")
      .insert(payload)
      .select("*")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not save the recurring correction.",
  );
  await audit({
    actor: input.actor,
    action: "timetable_correction.created",
    entityType: "timetable_correction_directive",
    entityId: String(row?.id),
    metadata: {
      timetableId: input.timetableId,
      correctionAction: input.action,
      sourceMayReplace: input.sourceMayReplace,
    },
  });
  return mapCorrection(row as JsonRecord);
}

export async function createSessionException(input: {
  timetableId: string;
  actor: StaffAuthContext;
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
}) {
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

  const row = await expectData<JsonRecord>(
    client()
      .from("timetable_session_exceptions")
      .insert(payload)
      .select("*")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not save the timetable exception.",
  );
  await audit({
    actor: input.actor,
    action: "timetable_exception.created",
    entityType: "timetable_session_exception",
    entityId: String(row?.id),
    metadata: {
      timetableId: input.timetableId,
      exceptionType: input.exceptionType,
    },
  });
  return mapException(row as JsonRecord);
}

export async function revokeCorrection(input: {
  timetableId: string;
  correctionId: string;
  actor: StaffAuthContext;
}) {
  await expectData(
    client()
      .from("timetable_correction_directives")
      .update({
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: input.actor.user.id,
      })
      .eq("id", input.correctionId)
      .eq("timetable_id", input.timetableId)
      .select("id")
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
}

export async function revokeException(input: {
  timetableId: string;
  exceptionId: string;
  actor: StaffAuthContext;
}) {
  await expectData(
    client()
      .from("timetable_session_exceptions")
      .update({
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: input.actor.user.id,
      })
      .eq("id", input.exceptionId)
      .eq("timetable_id", input.timetableId)
      .select("id")
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
}
