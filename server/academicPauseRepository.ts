import type {
  AcademicPauseReason,
  AcademicPauseScope,
  AcademicSchedulePause,
  AdminAcademicSchedulePause,
} from "../src/api/pilotTypes.js";
import type { StaffAuthContext } from "./supabase/auth.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

export class AcademicPauseRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type AcademicPauseInput = {
  scopeType: AcademicPauseScope;
  institutionId?: string | null;
  programmeId?: string | null;
  cohortId?: string | null;
  timetableId?: string | null;
  stableSessionKey?: string | null;
  startsOn: string;
  endsOn: string;
  allDay: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  reason: AcademicPauseReason;
  label: string;
  provenance?: string | null;
};

function client() {
  return createSupabaseAdminClient();
}

function isMissingPauseSchema(error: unknown) {
  const typed = error as SupabaseErrorLike | null;
  return (
    typed?.code === "42P01" ||
    /academic_schedule_pauses.*does not exist/i.test(typed?.message ?? "")
  );
}

function mapPause(row: JsonRecord): AdminAcademicSchedulePause {
  return {
    id: String(row.id),
    scopeType: row.scope_type as AcademicPauseScope,
    institutionId: row.institution_id ? String(row.institution_id) : null,
    programmeId: row.programme_id ? String(row.programme_id) : null,
    cohortId: row.cohort_id ? String(row.cohort_id) : null,
    timetableId: row.timetable_id ? String(row.timetable_id) : null,
    stableSessionKey: row.stable_session_key
      ? String(row.stable_session_key)
      : null,
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
    allDay: Boolean(row.all_day),
    startsAt: row.starts_at ? String(row.starts_at) : null,
    endsAt: row.ends_at ? String(row.ends_at) : null,
    reason: row.reason as AcademicPauseReason,
    label: String(row.label),
    provenance: row.provenance ? String(row.provenance) : null,
    creatorRole: row.creator_role as AdminAcademicSchedulePause["creatorRole"],
    active: Boolean(row.active),
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toPublicAcademicPause(
  pause: AdminAcademicSchedulePause,
): AcademicSchedulePause {
  return {
    id: pause.id,
    scopeType: pause.scopeType,
    stableSessionKey: pause.stableSessionKey,
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    allDay: pause.allDay,
    startsAt: pause.startsAt,
    endsAt: pause.endsAt,
    reason: pause.reason,
    label: pause.label,
    active: pause.active,
    createdAt: pause.createdAt,
  };
}

function validateInput(input: AcademicPauseInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_RANGE",
      "Choose a valid pause start date.",
      422,
    );
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) ||
    input.endsOn < input.startsOn
  ) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_RANGE",
      "Pause end date must be on or after the start date.",
      422,
    );
  }
  if (!input.label.trim()) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_LABEL",
      "Give this no-lecture period a short label.",
      422,
    );
  }
  if (!input.allDay) {
    const start = input.startsAt ? new Date(input.startsAt) : null;
    const end = input.endsAt ? new Date(input.endsAt) : null;
    if (
      !start ||
      !end ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new AcademicPauseRepositoryError(
        "INVALID_PAUSE_RANGE",
        "A bounded pause needs a valid start and end time.",
        422,
      );
    }
  }

  const targetCount = [
    input.institutionId,
    input.programmeId,
    input.cohortId,
    input.timetableId,
  ].filter(Boolean).length;
  if (input.scopeType === "session") {
    if (
      targetCount !== 1 ||
      !input.timetableId ||
      !input.stableSessionKey?.trim()
    ) {
      throw new AcademicPauseRepositoryError(
        "INVALID_PAUSE_SCOPE",
        "A session pause needs one timetable and one recurring session.",
        422,
      );
    }
  } else if (targetCount !== 1) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_SCOPE",
      "Choose exactly one pause scope.",
      422,
    );
  }
}

function enforceScopeShape(input: AcademicPauseInput) {
  const expectedTarget = {
    institution: input.institutionId,
    programme: input.programmeId,
    cohort: input.cohortId,
    timetable: input.timetableId,
    session: input.timetableId,
  }[input.scopeType];
  if (!expectedTarget) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_SCOPE",
      `The ${input.scopeType} pause is missing its target.`,
      422,
    );
  }
  if (
    (input.scopeType !== "institution" && input.institutionId) ||
    (input.scopeType !== "programme" && input.programmeId) ||
    (input.scopeType !== "cohort" && input.cohortId) ||
    (input.scopeType !== "timetable" &&
      input.scopeType !== "session" &&
      input.timetableId)
  ) {
    throw new AcademicPauseRepositoryError(
      "INVALID_PAUSE_SCOPE",
      "Pause scope contains conflicting targets.",
      422,
    );
  }
}

function enforceActorScope(actor: StaffAuthContext, input: AcademicPauseInput) {
  if (actor.permissions.canManageAllTimetables) return;
  if (actor.staff.role !== "class_rep") {
    throw new AcademicPauseRepositoryError(
      "FORBIDDEN",
      "You cannot manage academic pauses.",
      403,
    );
  }
  if (input.scopeType !== "timetable" && input.scopeType !== "session") {
    throw new AcademicPauseRepositoryError(
      "FORBIDDEN",
      "Class Reps can pause only an assigned timetable or one recurring class.",
      403,
    );
  }
  const allowed = actor.assignments.some(
    (assignment) => assignment.timetableId === input.timetableId,
  );
  if (!allowed) {
    throw new AcademicPauseRepositoryError(
      "FORBIDDEN",
      "This timetable is not assigned to your Class Rep account.",
      403,
    );
  }
}

export async function createAcademicPause(input: {
  actor: StaffAuthContext;
  pause: AcademicPauseInput;
}) {
  validateInput(input.pause);
  enforceScopeShape(input.pause);
  enforceActorScope(input.actor, input.pause);

  const { data, error } = await client()
    .from("academic_schedule_pauses")
    .insert({
      scope_type: input.pause.scopeType,
      institution_id: input.pause.institutionId ?? null,
      programme_id: input.pause.programmeId ?? null,
      cohort_id: input.pause.cohortId ?? null,
      timetable_id: input.pause.timetableId ?? null,
      stable_session_key:
        input.pause.scopeType === "session"
          ? input.pause.stableSessionKey?.trim() || null
          : null,
      starts_on: input.pause.startsOn,
      ends_on: input.pause.endsOn,
      all_day: input.pause.allDay,
      starts_at: input.pause.allDay ? null : (input.pause.startsAt ?? null),
      ends_at: input.pause.allDay ? null : (input.pause.endsAt ?? null),
      reason: input.pause.reason,
      label: input.pause.label.trim(),
      provenance: input.pause.provenance?.trim() || null,
      creator_role: input.actor.staff.role,
      creator_user_id: input.actor.user.id,
      creator_staff_user_id: input.actor.staff.id,
      active: true,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    if (isMissingPauseSchema(error)) {
      throw new AcademicPauseRepositoryError(
        "PAUSE_SCHEMA_REQUIRED",
        "Academic pause support needs the DR-58 database migration before it can be used.",
        503,
        error,
      );
    }
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not save the no-lecture period.",
      503,
      error,
    );
  }
  return mapPause(data as JsonRecord);
}

export async function listActiveAcademicPausesForTimetable(input: {
  timetableId: string;
  institutionId: string;
  programmeId: string;
  cohortId: string;
  startsOn: string | null;
  endsOn: string | null;
}): Promise<AcademicSchedulePause[]> {
  let query = client()
    .from("academic_schedule_pauses")
    .select("*")
    .eq("active", true)
    .or(
      [
        `institution_id.eq.${input.institutionId}`,
        `programme_id.eq.${input.programmeId}`,
        `cohort_id.eq.${input.cohortId}`,
        `timetable_id.eq.${input.timetableId}`,
      ].join(","),
    );
  if (input.endsOn) query = query.lte("starts_on", input.endsOn);
  if (input.startsOn) query = query.gte("ends_on", input.startsOn);
  const { data, error } = await query.order("created_at", { ascending: true });

  // Deployment-order safety: a web release arriving before migration 0023 must
  // not take public timetables or staff sign-in down. Mutating endpoints remain
  // fail-closed with PAUSE_SCHEMA_REQUIRED until the migration is applied.
  if (isMissingPauseSchema(error)) return [];
  if (error) {
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not load academic pause rules.",
      503,
      error,
    );
  }
  return (data ?? []).map((row) =>
    toPublicAcademicPause(mapPause(row as JsonRecord)),
  );
}

export async function listAcademicPausesForTimetable(timetableId: string) {
  const { data, error } = await client()
    .from("academic_schedule_pauses")
    .select("*")
    .eq("timetable_id", timetableId)
    .order("created_at", { ascending: false });
  if (isMissingPauseSchema(error)) return [];
  if (error) {
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not load timetable pauses.",
      503,
      error,
    );
  }
  return (data ?? []).map((row) => mapPause(row as JsonRecord));
}

export async function listPublishedTimetableIdsForPauseScope(
  pause: AcademicPauseInput,
) {
  let query = client()
    .from("timetables")
    .select("id")
    .not("current_published_version_id", "is", null);
  if (pause.scopeType === "institution") {
    query = query.eq("institution_id", pause.institutionId as string);
  } else if (pause.scopeType === "programme") {
    query = query.eq("programme_id", pause.programmeId as string);
  } else if (pause.scopeType === "cohort") {
    query = query.eq("cohort_id", pause.cohortId as string);
  } else {
    query = query.eq("id", pause.timetableId as string);
  }
  const { data, error } = await query;
  if (error) {
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not resolve timetables affected by this pause.",
      503,
      error,
    );
  }
  return (data ?? []).map((row) => String((row as JsonRecord).id));
}

export async function deactivateAcademicPause(input: {
  actor: StaffAuthContext;
  pauseId: string;
  timetableId?: string | null;
}) {
  const pauseResult = await client()
    .from("academic_schedule_pauses")
    .select("*")
    .eq("id", input.pauseId)
    .maybeSingle();
  if (isMissingPauseSchema(pauseResult.error)) {
    throw new AcademicPauseRepositoryError(
      "PAUSE_SCHEMA_REQUIRED",
      "Academic pause support is not available yet.",
      503,
    );
  }
  if (pauseResult.error) {
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not load the no-lecture period.",
      503,
      pauseResult.error,
    );
  }
  if (!pauseResult.data) {
    throw new AcademicPauseRepositoryError(
      "NOT_FOUND",
      "No-lecture period not found.",
      404,
    );
  }
  const pause = mapPause(pauseResult.data as JsonRecord);

  if (!input.actor.permissions.canManageAllTimetables) {
    const scoped =
      (pause.scopeType === "timetable" || pause.scopeType === "session") &&
      pause.timetableId &&
      pause.timetableId === input.timetableId &&
      input.actor.assignments.some(
        (assignment) => assignment.timetableId === pause.timetableId,
      );
    if (!scoped) {
      throw new AcademicPauseRepositoryError(
        "FORBIDDEN",
        "Class Reps cannot resume institution or programme pauses.",
        403,
      );
    }
  }

  if (!pause.active) return pause;
  const now = new Date().toISOString();
  const { data, error } = await client()
    .from("academic_schedule_pauses")
    .update({
      active: false,
      disabled_at: now,
      disabled_by_user_id: input.actor.user.id,
      disabled_by_staff_user_id: input.actor.staff.id,
      updated_at: now,
    })
    .eq("id", pause.id)
    .eq("active", true)
    .select("*")
    .single();
  if (error || !data) {
    throw new AcademicPauseRepositoryError(
      "DATABASE_UNAVAILABLE",
      "Could not resume classes for this pause.",
      503,
      error,
    );
  }
  return mapPause(data as JsonRecord);
}
