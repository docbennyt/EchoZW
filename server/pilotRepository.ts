import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type {
  AdminCourseMemoryEntry,
  AdminAcademicPeriod,
  AdminClassGroup,
  AdminInstitution,
  AdminProgramme,
  AdminTimetableEditor,
  AdminTimetableSession,
  AdminTimetableSummary,
  AdminTimetableVersion,
  PublicTimetable,
  PublicTimetableSession,
} from "../src/api/pilotTypes.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: { message?: string } | null };
type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

let repositoryEnv: NodeJS.ProcessEnv | undefined;

export class PilotApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function setPilotRepositoryEnv(env: NodeJS.ProcessEnv) {
  repositoryEnv = env;
}

function createPilotAdminClient() {
  return createSupabaseAdminClient(repositoryEnv ?? process.env);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function weekdayName(weekday: number) {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday - 1] ?? "Unknown";
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function requireString(value: string, code: string, message: string) {
  if (!value.trim()) {
    throw new PilotApiError(code, message, 422);
  }
}

function assertTimeRange(startTime: string, endTime: string) {
  if (normalizeTimeValue(endTime) <= normalizeTimeValue(startTime)) {
    throw new PilotApiError(
      "INVALID_TIME_RANGE",
      "Class end time must be after the start time.",
      422,
    );
  }
}

function normalizeTimeValue(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return value.trim();
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function stableSessionKeyFor(input: {
  courseCode: string;
  weekday: number;
  startTime: string;
  endTime: string;
  sessionType?: string | null;
}) {
  return [
    slugify(input.courseCode.trim()),
    input.weekday,
    normalizeTimeValue(input.startTime),
    normalizeTimeValue(input.endTime),
    slugify(input.sessionType?.trim() || "session"),
  ].join("__");
}

function buildCourseMemoryEntries(
  sessions: Array<{
    courseCode: string;
    courseName: string;
    lecturer?: string | null;
    venue?: string | null;
    sessionType?: string | null;
  }>,
): AdminCourseMemoryEntry[] {
  const byCode = new Map<string, AdminCourseMemoryEntry>();
  for (const session of sessions) {
    const courseCode = session.courseCode.trim();
    if (!courseCode) continue;
    const existing = byCode.get(courseCode) ?? {
      courseCode,
      courseName: session.courseName.trim(),
      lecturerSuggestions: [],
      venueSuggestions: [],
      sessionTypeSuggestions: [],
    };
    if (!existing.courseName && session.courseName.trim()) {
      existing.courseName = session.courseName.trim();
    }
    const lecturer = session.lecturer?.trim();
    if (lecturer && !existing.lecturerSuggestions.includes(lecturer)) {
      existing.lecturerSuggestions.push(lecturer);
    }
    const venue = session.venue?.trim();
    if (venue && !existing.venueSuggestions.includes(venue)) {
      existing.venueSuggestions.push(venue);
    }
    const sessionType = session.sessionType?.trim();
    if (sessionType && !existing.sessionTypeSuggestions.includes(sessionType)) {
      existing.sessionTypeSuggestions.push(sessionType);
    }
    byCode.set(courseCode, existing);
  }
  return [...byCode.values()].sort((left, right) =>
    left.courseCode.localeCompare(right.courseCode),
  );
}

function mapInstitution(row: JsonRecord): AdminInstitution {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: row.short_name ? String(row.short_name) : null,
    slug: String(row.slug),
    timezone: String(row.timezone),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProgramme(row: JsonRecord): AdminProgramme {
  const institution = asSingle(row.institutions as JsonRecord | JsonRecord[] | null);
  return {
    id: String(row.id),
    institutionId: String(row.institution_id),
    institutionName: institution?.name ? String(institution.name) : "",
    name: String(row.name),
    code: row.code ? String(row.code) : null,
    slug: String(row.slug),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapClassGroup(row: JsonRecord): AdminClassGroup {
  const programme = asSingle(row.programmes as JsonRecord | JsonRecord[] | null);
  return {
    id: String(row.id),
    programmeId: String(row.programme_id),
    programmeName: programme?.name ? String(programme.name) : "",
    label: String(row.label),
    code: String(row.code),
    slug: String(row.slug),
    yearLevel: row.year_level === null ? null : Number(row.year_level),
    semesterNumber:
      row.semester_number === null ? null : Number(row.semester_number),
    groupName: row.group_name ? String(row.group_name) : null,
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAcademicPeriod(row: JsonRecord): AdminAcademicPeriod {
  const institution = asSingle(row.institutions as JsonRecord | JsonRecord[] | null);
  return {
    id: String(row.id),
    institutionId: String(row.institution_id),
    institutionName: institution?.name ? String(institution.name) : "",
    name: String(row.name),
    startsOn: row.starts_on ? String(row.starts_on) : null,
    endsOn: row.ends_on ? String(row.ends_on) : null,
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVersion(row: JsonRecord, sessionCount = 0): AdminTimetableVersion {
  return {
    id: String(row.id),
    versionNumber: Number(row.version_number ?? 1),
    status: row.status as AdminTimetableVersion["status"],
    publishedAt: row.published_at ? String(row.published_at) : null,
    changeSummary: row.change_summary ? String(row.change_summary) : null,
    createdAt: String(row.created_at),
    sessionCount,
  };
}

function mapSession(row: JsonRecord): AdminTimetableSession {
  return {
    id: String(row.id),
    timetableVersionId: String(row.timetable_version_id),
    stableSessionKey: String(row.stable_session_key),
    courseCode: String(row.course_code),
    courseName: String(row.course_name),
    weekday: Number(row.weekday),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    venue: row.venue ? String(row.venue) : null,
    lecturer: row.lecturer ? String(row.lecturer) : null,
    sessionType: row.session_type ? String(row.session_type) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

async function expectData<T = unknown>(
  query: PromiseLike<QueryResult<T>>,
  code: string,
  message: string,
) {
  const { data, error } = await query;
  if (error) {
    throw new PilotApiError(code, message, 503, error);
  }
  return data as T | null;
}

async function requireInstitution(id: string) {
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("institutions")
      .select("id, name, short_name, slug, timezone, active, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Institution lookup failed.",
  );
  if (!data) {
    throw new PilotApiError("NOT_FOUND", "Institution not found.", 404);
  }
  return mapInstitution(data as unknown as JsonRecord);
}

async function requireProgramme(id: string) {
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("programmes")
      .select("id, institution_id, name, code, slug, active, created_at, updated_at, institutions(name)")
      .eq("id", id)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Programme lookup failed.",
  );
  if (!data) throw new PilotApiError("NOT_FOUND", "Programme not found.", 404);
  return mapProgramme(data as unknown as JsonRecord);
}

async function requireClassGroup(id: string) {
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("cohorts")
      .select("id, programme_id, label, code, slug, year_level, semester_number, group_name, active, created_at, updated_at, programmes(name)")
      .eq("id", id)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Class group lookup failed.",
  );
  if (!data) throw new PilotApiError("NOT_FOUND", "Class group not found.", 404);
  return mapClassGroup(data as unknown as JsonRecord);
}

async function requireAcademicPeriod(id: string) {
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("academic_periods")
      .select("id, institution_id, name, starts_on, ends_on, active, created_at, updated_at, institutions(name)")
      .eq("id", id)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Academic period lookup failed.",
  );
  if (!data) {
    throw new PilotApiError("NOT_FOUND", "Academic period not found.", 404);
  }
  return mapAcademicPeriod(data as unknown as JsonRecord);
}

async function ensureUniquePublicSlug(baseSlug: string) {
  const client = createPilotAdminClient();
  let candidate = baseSlug;
  let suffix = 2;

  for (;;) {
    const { data, error } = await client
      .from("timetables")
      .select("id")
      .eq("public_slug", candidate)
      .limit(1);
    if (error) {
      throw new PilotApiError(
        "DATABASE_UNAVAILABLE",
        "Could not verify timetable slug availability.",
        503,
        error,
      );
    }
    if (!data || data.length === 0) return candidate;
    candidate = `${baseSlug}-${suffix++}`;
  }
}

function deriveAcademicYear(name: string, startsOn: string | null, endsOn: string | null) {
  if (startsOn) return startsOn.slice(0, 4);
  if (endsOn) return endsOn.slice(0, 4);
  const match = name.match(/\b(20\d{2})\b/);
  return match?.[1] ?? new Date().getUTCFullYear().toString();
}

function derivePeriodNumber(name: string) {
  const match = name.match(/\b([1-4])\b/);
  return match ? Number(match[1]) : null;
}

function deriveYearLevel(label: string) {
  const match = label.match(/(?:part|year)\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function deriveSemesterNumber(label: string) {
  const match = label.match(/(\d+)\.(\d+)/);
  return match ? Number(match[2]) : null;
}

function detectOverlap(
  sessions: Array<{
    id: string;
    courseCode: string;
    weekday: number;
    startTime: string;
    endTime: string;
  }>,
  candidate: {
    id?: string;
    courseCode: string;
    weekday: number;
    startTime: string;
    endTime: string;
  },
) {
  for (const session of sessions) {
    if (candidate.id && session.id === candidate.id) continue;
    if (session.weekday !== candidate.weekday) continue;
    const candidateStart = normalizeTimeValue(candidate.startTime);
    const candidateEnd = normalizeTimeValue(candidate.endTime);
    const sessionStart = normalizeTimeValue(session.startTime);
    const sessionEnd = normalizeTimeValue(session.endTime);
    if (candidateStart < sessionEnd && candidateEnd > sessionStart) {
      throw new PilotApiError(
        "TIMETABLE_CONFLICT",
        `${candidate.courseCode} overlaps with ${session.courseCode} on ${weekdayName(candidate.weekday)} between ${sessionStart.slice(0, 5)} and ${sessionEnd.slice(0, 5)}.`,
        409,
      );
    }
  }
}

async function getVersionsForTimetable(timetableId: string) {
  const client = createPilotAdminClient();
  const versions = await expectData(
    client
      .from("timetable_versions")
      .select("id, version_number, status, published_at, change_summary, created_at")
      .eq("timetable_id", timetableId)
      .order("version_number", { ascending: false }),
    "DATABASE_UNAVAILABLE",
    "Timetable version lookup failed.",
  );
  const versionIds = (versions ?? []).map((row: unknown) => String((row as JsonRecord).id));
  const sessions = versionIds.length
    ? await expectData(
        client
          .from("timetable_sessions")
          .select("id, timetable_version_id")
          .in("timetable_version_id", versionIds),
        "DATABASE_UNAVAILABLE",
        "Timetable session lookup failed.",
      )
    : [];

  const counts = new Map<string, number>();
  for (const session of sessions ?? []) {
    const versionId = String((session as JsonRecord).timetable_version_id);
    counts.set(versionId, (counts.get(versionId) ?? 0) + 1);
  }

  return (versions ?? []).map((row: unknown) =>
    mapVersion(row as JsonRecord, counts.get(String((row as JsonRecord).id)) ?? 0),
  );
}

async function createDraftFromPublished(timetableId: string, createdBy: string) {
  const client = createPilotAdminClient();
  const versions = await getVersionsForTimetable(timetableId);
  const draft = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "draft");
  if (draft) return draft.id;

  const published = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "published");
  if (!published) {
    throw new PilotApiError("NOT_FOUND", "Timetable draft not found.", 404);
  }

  const nextVersionNumber =
    Math.max(...versions.map((version: unknown) => (version as AdminTimetableVersion).versionNumber), 0) + 1;

  const insertedVersion = await expectData(
    client
      .from("timetable_versions")
      .insert({
        timetable_id: timetableId,
        version_label: `v${nextVersionNumber}`,
        source: "manual",
        version_number: nextVersionNumber,
        status: "draft",
        change_summary: "Draft created from published version",
        created_by: createdBy,
        source_label: "Manual update",
      })
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create a new draft version.",
  );

  const sourceSessions = await expectData(
    client
      .from("timetable_sessions")
      .select("*")
      .eq("timetable_version_id", published.id),
    "DATABASE_UNAVAILABLE",
    "Could not copy published timetable sessions.",
  );

  if (sourceSessions && sourceSessions.length > 0) {
    const insertedVersionRecord = insertedVersion as unknown as JsonRecord;
    const copiedSessions = sourceSessions.map((row: unknown) => {
      const source = row as JsonRecord;
      return {
        timetable_version_id: String(insertedVersionRecord.id),
        stable_session_key: String(source.stable_session_key),
        course_id: source.course_id ?? null,
        programme_course_id: source.programme_course_id ?? null,
        course_code: String(source.course_code),
        course_name: String(source.course_name),
        session_type: source.session_type ?? null,
        weekday: Number(source.weekday),
        start_time: String(source.start_time),
        end_time: String(source.end_time),
        starts_on: String(source.starts_on),
        ends_on: String(source.ends_on),
        venue: source.venue ?? null,
        venue_raw: source.venue ?? source.venue_raw ?? null,
        venue_normalized: source.venue ?? source.venue_normalized ?? null,
        lecturer: source.lecturer ?? null,
        lecturer_raw: source.lecturer ?? source.lecturer_raw ?? null,
        lecturer_normalized:
          source.lecturer ?? source.lecturer_normalized ?? null,
        group_label: source.group_label ?? null,
        notes: source.notes ?? null,
        status: source.status ?? "confirmed",
      };
    });

    const { error } = await client.from("timetable_sessions").insert(copiedSessions);
    if (error) {
      throw new PilotApiError(
        "DATABASE_UNAVAILABLE",
        "Could not copy published timetable sessions.",
        503,
        error,
      );
    }
  }

  return String((insertedVersion as unknown as JsonRecord).id);
}

async function createInitialDraftVersion(
  timetableId: string,
  createdBy: string,
  versionNumber = 1,
) {
  const client = createPilotAdminClient();
  const insertedVersion = await expectData(
    client
      .from("timetable_versions")
      .insert({
        timetable_id: timetableId,
        version_label: `v${versionNumber}`,
        source: "manual",
        version_number: versionNumber,
        status: "draft",
        change_summary: versionNumber === 1 ? "Initial draft" : "Recovered draft",
        created_by: createdBy,
        source_label: "Manual entry",
      })
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create a draft timetable version.",
  );
  if (!insertedVersion) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not create a draft timetable version.",
      503,
    );
  }
  const insertedVersionRecord = insertedVersion as unknown as JsonRecord;

  await expectData(
    client
      .from("timetables")
      .update({
        current_version_id: insertedVersionRecord.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", timetableId)
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not finalize the recovered timetable draft.",
  );

  return String(insertedVersionRecord.id);
}

async function getEditableVersion(timetableId: string, userId: string) {
  const versions = await getVersionsForTimetable(timetableId);
  const existingDraft = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "draft");
  if (existingDraft) return existingDraft.id;
  const published = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "published");
  if (published) {
    return createDraftFromPublished(timetableId, userId);
  }
  const nextVersionNumber =
    Math.max(...versions.map((version: unknown) => (version as AdminTimetableVersion).versionNumber), 0) + 1;
  return createInitialDraftVersion(timetableId, userId, nextVersionNumber);
}

export async function listInstitutions() {
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("institutions")
      .select("id, name, short_name, slug, timezone, active, created_at, updated_at")
      .order("name"),
    "DATABASE_UNAVAILABLE",
    "Could not load institutions.",
  );
  return (data ?? []).map((row: unknown) => mapInstitution(row as JsonRecord));
}

export async function createInstitution(input: {
  name: string;
  shortName?: string | null;
  slug?: string | null;
  timezone?: string | null;
  active?: boolean;
}) {
  requireString(input.name, "VALIDATION_ERROR", "Institution name is required.");
  const client = createPilotAdminClient();
  const payload = {
    name: input.name.trim(),
    short_name: input.shortName?.trim() || null,
    slug: slugify(input.slug?.trim() || input.shortName?.trim() || input.name),
    timezone: input.timezone?.trim() || "Africa/Harare",
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("institutions")
    .insert(payload)
    .select("id, name, short_name, slug, timezone, active, created_at, updated_at")
    .single();
  if (error) {
    const databaseError = error as SupabaseErrorLike;
    if (databaseError.code === "23505") {
      throw new PilotApiError(
        "CONFLICT",
        "An institution with this slug already exists.",
        409,
        { field: "slug" },
      );
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "CalenderZW could not save this institution. Please try again.",
      503,
      {
        code: databaseError.code ?? null,
        message: databaseError.message ?? null,
      },
    );
  }
  return mapInstitution(data as unknown as JsonRecord);
}

export async function updateInstitution(
  id: string,
  input: Partial<{
    name: string;
    shortName: string | null;
    slug: string | null;
    timezone: string | null;
    active: boolean;
  }>,
) {
  const client = createPilotAdminClient();
  const current = await requireInstitution(id);
  const payload = {
    name: input.name?.trim() || current.name,
    short_name:
      input.shortName === undefined ? current.shortName : input.shortName?.trim() || null,
    slug:
      input.slug === undefined
        ? current.slug
        : slugify(input.slug || input.name || current.name),
    timezone: input.timezone?.trim() || current.timezone,
    active: input.active ?? current.active,
    updated_at: new Date().toISOString(),
  };
  const data = await expectData(
    client
      .from("institutions")
      .update(payload)
      .eq("id", id)
      .select("id, name, short_name, slug, timezone, active, created_at, updated_at")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not update institution.",
  );
  return mapInstitution(data as unknown as JsonRecord);
}

export async function listProgrammes(institutionId?: string) {
  const client = createPilotAdminClient();
  let query = client
    .from("programmes")
    .select("id, institution_id, name, code, slug, active, created_at, updated_at, institutions(name)")
    .order("name");
  if (institutionId) query = query.eq("institution_id", institutionId);
  const data = await expectData(
    query,
    "DATABASE_UNAVAILABLE",
    "Could not load programmes.",
  );
  return (data ?? []).map((row: unknown) => mapProgramme(row as JsonRecord));
}

export async function createProgramme(input: {
  institutionId: string;
  name: string;
  code?: string | null;
  slug?: string | null;
  active?: boolean;
}) {
  requireString(input.name, "VALIDATION_ERROR", "Programme name is required.");
  const institution = await requireInstitution(input.institutionId);
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("programmes")
      .insert({
        institution_id: institution.id,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        slug: slugify(input.slug?.trim() || input.code?.trim() || input.name),
        active: input.active ?? true,
        status: input.active === false ? "inactive" : "active",
        updated_at: new Date().toISOString(),
      })
      .select("id, institution_id, name, code, slug, active, created_at, updated_at, institutions(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create programme.",
  );
  return mapProgramme(data as unknown as JsonRecord);
}

export async function updateProgramme(
  id: string,
  input: Partial<{
    institutionId: string;
    name: string;
    code: string | null;
    slug: string | null;
    active: boolean;
  }>,
) {
  const current = await requireProgramme(id);
  const institutionId = input.institutionId ?? current.institutionId;
  await requireInstitution(institutionId);
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("programmes")
      .update({
        institution_id: institutionId,
        name: input.name?.trim() || current.name,
        code: input.code === undefined ? current.code : input.code?.trim() || null,
        slug:
          input.slug === undefined
            ? current.slug
            : slugify(input.slug || input.code || input.name || current.name),
        active: input.active ?? current.active,
        status: (input.active ?? current.active) ? "active" : "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, institution_id, name, code, slug, active, created_at, updated_at, institutions(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not update programme.",
  );
  return mapProgramme(data as unknown as JsonRecord);
}

export async function listClassGroups(programmeId?: string) {
  const client = createPilotAdminClient();
  let query = client
    .from("cohorts")
    .select("id, programme_id, label, code, slug, year_level, semester_number, group_name, active, created_at, updated_at, programmes(name)")
    .order("label");
  if (programmeId) query = query.eq("programme_id", programmeId);
  const data = await expectData(
    query,
    "DATABASE_UNAVAILABLE",
    "Could not load class groups.",
  );
  return (data ?? []).map((row: unknown) => mapClassGroup(row as JsonRecord));
}

export async function createClassGroup(input: {
  programmeId: string;
  label: string;
  slug?: string | null;
  yearLevel?: number | null;
  semesterNumber?: number | null;
  groupName?: string | null;
  active?: boolean;
}) {
  requireString(input.label, "VALIDATION_ERROR", "Class group label is required.");
  if (input.yearLevel !== undefined && input.yearLevel !== null && input.yearLevel <= 0) {
    throw new PilotApiError("VALIDATION_ERROR", "Year level must be greater than zero.", 422);
  }
  if (
    input.semesterNumber !== undefined &&
    input.semesterNumber !== null &&
    input.semesterNumber <= 0
  ) {
    throw new PilotApiError("VALIDATION_ERROR", "Semester number must be greater than zero.", 422);
  }
  const programme = await requireProgramme(input.programmeId);
  const client = createPilotAdminClient();
  const label = input.label.trim();
  const data = await expectData(
    client
      .from("cohorts")
      .insert({
        programme_id: programme.id,
        label,
        code: label,
        level_label: label,
        slug: slugify(input.slug?.trim() || label),
        year_level:
          input.yearLevel === undefined ? deriveYearLevel(label) : input.yearLevel,
        semester_number:
          input.semesterNumber === undefined
            ? deriveSemesterNumber(label)
            : input.semesterNumber,
        group_name: input.groupName?.trim() || null,
        group_label: input.groupName?.trim() || null,
        active: input.active ?? true,
        status: input.active === false ? "inactive" : "active",
        updated_at: new Date().toISOString(),
      })
      .select("id, programme_id, label, code, slug, year_level, semester_number, group_name, active, created_at, updated_at, programmes(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create class group.",
  );
  return mapClassGroup(data as unknown as JsonRecord);
}

export async function updateClassGroup(
  id: string,
  input: Partial<{
    programmeId: string;
    label: string;
    slug: string | null;
    yearLevel: number | null;
    semesterNumber: number | null;
    groupName: string | null;
    active: boolean;
  }>,
) {
  const current = await requireClassGroup(id);
  if (input.yearLevel !== undefined && input.yearLevel !== null && input.yearLevel <= 0) {
    throw new PilotApiError("VALIDATION_ERROR", "Year level must be greater than zero.", 422);
  }
  if (
    input.semesterNumber !== undefined &&
    input.semesterNumber !== null &&
    input.semesterNumber <= 0
  ) {
    throw new PilotApiError("VALIDATION_ERROR", "Semester number must be greater than zero.", 422);
  }
  const programmeId = input.programmeId ?? current.programmeId;
  await requireProgramme(programmeId);
  const label = input.label?.trim() || current.label;
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("cohorts")
      .update({
        programme_id: programmeId,
        label,
        code: label,
        level_label: label,
        slug: input.slug === undefined ? current.slug : slugify(input.slug || label),
        year_level: input.yearLevel === undefined ? current.yearLevel : input.yearLevel,
        semester_number:
          input.semesterNumber === undefined
            ? current.semesterNumber
            : input.semesterNumber,
        group_name:
          input.groupName === undefined ? current.groupName : input.groupName?.trim() || null,
        group_label:
          input.groupName === undefined ? current.groupName : input.groupName?.trim() || null,
        active: input.active ?? current.active,
        status: (input.active ?? current.active) ? "active" : "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, programme_id, label, code, slug, year_level, semester_number, group_name, active, created_at, updated_at, programmes(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not update class group.",
  );
  return mapClassGroup(data as unknown as JsonRecord);
}

export async function listAcademicPeriods(institutionId?: string) {
  const client = createPilotAdminClient();
  let query = client
    .from("academic_periods")
    .select("id, institution_id, name, starts_on, ends_on, active, created_at, updated_at, institutions(name)")
    .order("starts_on", { ascending: false })
    .order("name");
  if (institutionId) query = query.eq("institution_id", institutionId);
  const data = await expectData(
    query,
    "DATABASE_UNAVAILABLE",
    "Could not load academic periods.",
  );
  return (data ?? []).map((row: unknown) => mapAcademicPeriod(row as JsonRecord));
}

export async function createAcademicPeriod(input: {
  institutionId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  active?: boolean;
}) {
  requireString(input.name, "VALIDATION_ERROR", "Academic period name is required.");
  requireString(input.startsOn, "VALIDATION_ERROR", "Start date is required.");
  requireString(input.endsOn, "VALIDATION_ERROR", "End date is required.");
  if (input.endsOn < input.startsOn) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Academic period end date must not be before the start date.",
      422,
    );
  }
  const institution = await requireInstitution(input.institutionId);
  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("academic_periods")
      .insert({
        institution_id: institution.id,
        name: input.name.trim(),
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        academic_year: deriveAcademicYear(input.name, input.startsOn, input.endsOn),
        period_number: derivePeriodNumber(input.name),
        active: input.active ?? true,
        status: input.active === false ? "archived" : "confirmed",
        updated_at: new Date().toISOString(),
      })
      .select("id, institution_id, name, starts_on, ends_on, active, created_at, updated_at, institutions(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create academic period.",
  );
  return mapAcademicPeriod(data as unknown as JsonRecord);
}

export async function updateAcademicPeriod(
  id: string,
  input: Partial<{
    institutionId: string;
    name: string;
    startsOn: string;
    endsOn: string;
    active: boolean;
  }>,
) {
  const current = await requireAcademicPeriod(id);
  const startsOn = input.startsOn ?? current.startsOn;
  const endsOn = input.endsOn ?? current.endsOn;
  if (!startsOn || !endsOn || endsOn < startsOn) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Academic period end date must not be before the start date.",
      422,
    );
  }
  const institutionId = input.institutionId ?? current.institutionId;
  await requireInstitution(institutionId);
  const client = createPilotAdminClient();
  const name = input.name?.trim() || current.name;
  const active = input.active ?? current.active;
  const data = await expectData(
    client
      .from("academic_periods")
      .update({
        institution_id: institutionId,
        name,
        starts_on: startsOn,
        ends_on: endsOn,
        academic_year: deriveAcademicYear(name, startsOn, endsOn),
        period_number: derivePeriodNumber(name),
        active,
        status: active ? "confirmed" : "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, institution_id, name, starts_on, ends_on, active, created_at, updated_at, institutions(name)")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not update academic period.",
  );
  return mapAcademicPeriod(data as unknown as JsonRecord);
}

export async function listTimetables() {
  const client = createPilotAdminClient();
  const rows = await expectData(
    client
      .from("timetables")
      .select("id, public_slug, updated_at, current_published_version_id, institution_id, programme_id, cohort_id, academic_period_id, institutions(name), programmes(name), cohorts(label), academic_periods(name)")
      .order("updated_at", { ascending: false }),
    "DATABASE_UNAVAILABLE",
    "Could not load timetables.",
  );

  const timetables = (rows ?? []) as JsonRecord[];
  const versionsByTimetable = new Map<string, AdminTimetableVersion[]>();
  for (const row of timetables) {
    versionsByTimetable.set(String(row.id), await getVersionsForTimetable(String(row.id)));
  }

  return timetables.map((row: unknown) => {
    const timetableRow = row as JsonRecord;
    const institution = asSingle(timetableRow.institutions as JsonRecord | JsonRecord[] | null);
    const programme = asSingle(timetableRow.programmes as JsonRecord | JsonRecord[] | null);
    const cohort = asSingle(timetableRow.cohorts as JsonRecord | JsonRecord[] | null);
    const period = asSingle(timetableRow.academic_periods as JsonRecord | JsonRecord[] | null);
    const versions = versionsByTimetable.get(String(timetableRow.id)) ?? [];
    const draft = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "draft");
    const published = versions.find((version: unknown) => (version as AdminTimetableVersion).status === "published");
    return {
      id: String(timetableRow.id),
      publicSlug: String(timetableRow.public_slug),
      institutionName: institution?.name ? String(institution.name) : "",
      programmeName: programme?.name ? String(programme.name) : "",
      classGroupLabel: cohort?.label ? String(cohort.label) : "",
      academicPeriodName: period?.name ? String(period.name) : "",
      status: published ? "Published" : "Draft",
      lastUpdated: String(timetableRow.updated_at),
      currentDraftVersionId: draft?.id ?? null,
      currentPublishedVersionId:
        timetableRow.current_published_version_id
          ? String(timetableRow.current_published_version_id)
          : null,
    } satisfies AdminTimetableSummary;
  });
}

export async function createTimetable(input: {
  institutionId: string;
  programmeId: string;
  classGroupId: string;
  academicPeriodId: string;
  createdBy: string;
}) {
  const institution = await requireInstitution(input.institutionId);
  const programme = await requireProgramme(input.programmeId);
  const classGroup = await requireClassGroup(input.classGroupId);
  const academicPeriod = await requireAcademicPeriod(input.academicPeriodId);

  if (programme.institutionId !== institution.id) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Programme does not belong to the selected institution.",
      422,
    );
  }
  if (classGroup.programmeId !== programme.id) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Class group does not belong to the selected programme.",
      422,
    );
  }
  if (academicPeriod.institutionId !== institution.id) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Academic period does not belong to the selected institution.",
      422,
    );
  }

  const client = createPilotAdminClient();
  const publicSlug = await ensureUniquePublicSlug(
    slugify(
      `${institution.shortName || institution.name}-${programme.code || programme.name}-${classGroup.label}-${academicPeriod.name}`,
    ),
  );

  const timetable = await expectData<JsonRecord | null>(
    client
      .from("timetables")
      .insert({
        institution_id: institution.id,
        slug: publicSlug,
        programme: programme.name,
        cohort: classGroup.label,
        semester: academicPeriod.name,
        status: "draft",
        programme_id: programme.id,
        cohort_id: classGroup.id,
        academic_period_id: academicPeriod.id,
        public_slug: publicSlug,
        created_by: input.createdBy,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create timetable.",
  );
  if (!timetable) {
    throw new PilotApiError("DATABASE_UNAVAILABLE", "Could not create timetable.", 503);
  }

  const version = await expectData<JsonRecord | null>(
    client
      .from("timetable_versions")
      .insert({
        timetable_id: timetable.id,
        version_label: "v1",
        source: "manual",
        version_number: 1,
        status: "draft",
        change_summary: "Initial draft",
        created_by: input.createdBy,
        source_label: "Manual entry",
      })
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create timetable draft version.",
  );
  if (!version) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not create timetable draft version.",
      503,
    );
  }

  await expectData(
    client
      .from("timetables")
      .update({
        current_version_id: version.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", timetable.id)
      .select("id")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not finalize timetable creation.",
  );

  return getTimetableEditor(String(timetable.id), input.createdBy);
}

export async function getTimetableEditor(timetableId: string, userId: string) {
  const client = createPilotAdminClient();
  const timetable = await expectData<JsonRecord | null>(
    client
      .from("timetables")
      .select("id, public_slug, institution_id, programme_id, cohort_id, academic_period_id, current_published_version_id, institutions(name), programmes(name), cohorts(label), academic_periods(name, starts_on, ends_on)")
      .eq("id", timetableId)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load timetable.",
  );
  if (!timetable) {
    throw new PilotApiError("NOT_FOUND", "Timetable not found.", 404);
  }

  const editableVersionId = await getEditableVersion(timetableId, userId);
  const versions = await getVersionsForTimetable(timetableId);
  const activeVersion = versions.find((version: unknown) => (version as AdminTimetableVersion).id === editableVersionId);
  if (!activeVersion) {
    throw new PilotApiError("NOT_FOUND", "Editable timetable version not found.", 404);
  }

  const sessions = await expectData(
    client
      .from("timetable_sessions")
      .select("id, timetable_version_id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
      .eq("timetable_version_id", editableVersionId)
      .order("weekday")
      .order("start_time"),
    "DATABASE_UNAVAILABLE",
    "Could not load timetable sessions.",
  );
  const versionIds = versions.map((version) => version.id);
  const courseMemoryRows = versionIds.length
    ? await expectData(
        client
          .from("timetable_sessions")
          .select("course_code, course_name, lecturer, venue, session_type")
          .in("timetable_version_id", versionIds),
        "DATABASE_UNAVAILABLE",
        "Could not load course memory.",
      )
    : [];

  const institution = asSingle((timetable as JsonRecord).institutions as JsonRecord | JsonRecord[] | null);
  const programme = asSingle((timetable as JsonRecord).programmes as JsonRecord | JsonRecord[] | null);
  const cohort = asSingle((timetable as JsonRecord).cohorts as JsonRecord | JsonRecord[] | null);
  const period = asSingle((timetable as JsonRecord).academic_periods as JsonRecord | JsonRecord[] | null);

  return {
    timetable: {
      id: String((timetable as JsonRecord).id),
      publicSlug: String((timetable as JsonRecord).public_slug),
      institutionId: String((timetable as JsonRecord).institution_id),
      institutionName: institution?.name ? String(institution.name) : "",
      programmeId: String((timetable as JsonRecord).programme_id),
      programmeName: programme?.name ? String(programme.name) : "",
      classGroupId: String((timetable as JsonRecord).cohort_id),
      classGroupLabel: cohort?.label ? String(cohort.label) : "",
      academicPeriodId: String((timetable as JsonRecord).academic_period_id),
      academicPeriodName: period?.name ? String(period.name) : "",
      academicPeriodStartsOn: period?.starts_on ? String(period.starts_on) : null,
      academicPeriodEndsOn: period?.ends_on ? String(period.ends_on) : null,
      currentPublishedVersionId:
        (timetable as JsonRecord).current_published_version_id
          ? String((timetable as JsonRecord).current_published_version_id)
          : null,
    },
    activeVersion,
    versions,
    sessions: (sessions ?? []).map((row: unknown) => mapSession(row as JsonRecord)),
    courseMemory: buildCourseMemoryEntries(
      (courseMemoryRows ?? []).map((row: unknown) => ({
        courseCode: String((row as JsonRecord).course_code ?? ""),
        courseName: String((row as JsonRecord).course_name ?? ""),
        lecturer: (row as JsonRecord).lecturer ? String((row as JsonRecord).lecturer) : null,
        venue: (row as JsonRecord).venue ? String((row as JsonRecord).venue) : null,
        sessionType: (row as JsonRecord).session_type ? String((row as JsonRecord).session_type) : null,
      })),
    ),
  } satisfies AdminTimetableEditor;
}

async function listDraftSessionsForTimetable(timetableId: string, userId: string) {
  const versionId = await getEditableVersion(timetableId, userId);
  const client = createPilotAdminClient();
  const sessions = await expectData(
    client
      .from("timetable_sessions")
      .select("id, stable_session_key, course_code, weekday, start_time, end_time")
      .eq("timetable_version_id", versionId),
    "DATABASE_UNAVAILABLE",
    "Could not load draft sessions.",
  );
  return {
    versionId,
    sessions: (sessions ?? []).map((row: unknown) => ({
      id: String((row as JsonRecord).id),
      courseCode: String((row as JsonRecord).course_code),
      weekday: Number((row as JsonRecord).weekday),
      startTime: normalizeTimeValue(String((row as JsonRecord).start_time)),
      endTime: normalizeTimeValue(String((row as JsonRecord).end_time)),
    })),
  };
}

export async function createTimetableSession(input: {
  timetableId: string;
  userId: string;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
}) {
  requireString(input.courseCode, "VALIDATION_ERROR", "Course code is required.");
  requireString(input.courseName, "VALIDATION_ERROR", "Course name is required.");
  if (input.weekday < 1 || input.weekday > 7) {
    throw new PilotApiError("VALIDATION_ERROR", "Weekday must be between 1 and 7.", 422);
  }
  assertTimeRange(input.startTime, input.endTime);

  const { versionId, sessions } = await listDraftSessionsForTimetable(
    input.timetableId,
    input.userId,
  );
  const client = createPilotAdminClient();

  const editor = await getTimetableEditor(input.timetableId, input.userId);
  if (!editor.timetable.academicPeriodStartsOn || !editor.timetable.academicPeriodEndsOn) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Academic period dates are required before adding timetable sessions.",
      422,
    );
  }

  const duplicate = sessions.find(
    (session: unknown) =>
      (session as { courseCode: string; weekday: number; startTime: string; endTime: string }).courseCode === input.courseCode.trim() &&
      (session as { courseCode: string; weekday: number; startTime: string; endTime: string }).weekday === input.weekday &&
      normalizeTimeValue((session as { courseCode: string; weekday: number; startTime: string; endTime: string }).startTime) === normalizeTimeValue(input.startTime) &&
      normalizeTimeValue((session as { courseCode: string; weekday: number; startTime: string; endTime: string }).endTime) === normalizeTimeValue(input.endTime),
  );
  if (duplicate) {
    const existingSession = await expectData(
      client
        .from("timetable_sessions")
        .select("id, timetable_version_id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
        .eq("id", duplicate.id)
        .maybeSingle(),
      "DATABASE_UNAVAILABLE",
      "Could not load the existing timetable session.",
    );
    if (existingSession) {
      return mapSession(existingSession as unknown as JsonRecord);
    }
  }

  detectOverlap(sessions, input);
  const payload = {
    timetable_version_id: versionId,
    stable_session_key: stableSessionKeyFor(input),
    course_code: input.courseCode.trim(),
    course_name: input.courseName.trim(),
    weekday: input.weekday,
    start_time: normalizeTimeValue(input.startTime),
    end_time: normalizeTimeValue(input.endTime),
    starts_on: editor.timetable.academicPeriodStartsOn,
    ends_on: editor.timetable.academicPeriodEndsOn,
    venue: input.venue?.trim() || null,
    venue_raw: input.venue?.trim() || null,
    venue_normalized: input.venue?.trim() || null,
    lecturer: input.lecturer?.trim() || null,
    lecturer_raw: input.lecturer?.trim() || null,
    lecturer_normalized: input.lecturer?.trim() || null,
    session_type: input.sessionType?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  const { data, error } = await client
    .from("timetable_sessions")
    .insert(payload)
    .select("id, timetable_version_id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
    .single();
  if (error) {
    const duplicateConflict = (error as SupabaseErrorLike).code === "23505";
    if (duplicateConflict) {
      const existing = await expectData(
        client
          .from("timetable_sessions")
          .select("id, timetable_version_id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
          .eq("timetable_version_id", versionId)
          .eq("stable_session_key", payload.stable_session_key)
          .maybeSingle(),
        "DATABASE_UNAVAILABLE",
        "Could not load the saved timetable session.",
      );
      if (existing) {
        return mapSession(existing as unknown as JsonRecord);
      }
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not save the timetable session.",
      503,
      error,
    );
  }
  return mapSession(data as unknown as JsonRecord);
}

export async function updateTimetableSession(input: {
  timetableId: string;
  sessionId: string;
  userId: string;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
}) {
  requireString(input.courseCode, "VALIDATION_ERROR", "Course code is required.");
  requireString(input.courseName, "VALIDATION_ERROR", "Course name is required.");
  if (input.weekday < 1 || input.weekday > 7) {
    throw new PilotApiError("VALIDATION_ERROR", "Weekday must be between 1 and 7.", 422);
  }
  assertTimeRange(input.startTime, input.endTime);

  const { versionId, sessions } = await listDraftSessionsForTimetable(
    input.timetableId,
    input.userId,
  );
  detectOverlap(sessions, { ...input, id: input.sessionId });

  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("timetable_sessions")
      .update({
        course_code: input.courseCode.trim(),
        course_name: input.courseName.trim(),
        weekday: input.weekday,
        start_time: input.startTime,
        end_time: input.endTime,
        venue: input.venue?.trim() || null,
        venue_raw: input.venue?.trim() || null,
        venue_normalized: input.venue?.trim() || null,
        lecturer: input.lecturer?.trim() || null,
        lecturer_raw: input.lecturer?.trim() || null,
        lecturer_normalized: input.lecturer?.trim() || null,
        session_type: input.sessionType?.trim() || null,
        notes: input.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.sessionId)
      .eq("timetable_version_id", versionId)
      .select("id, timetable_version_id, stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not update the timetable session.",
  );
  return mapSession(data as unknown as JsonRecord);
}

export async function deleteTimetableSession(input: {
  timetableId: string;
  sessionId: string;
  userId: string;
}) {
  const { versionId } = await listDraftSessionsForTimetable(
    input.timetableId,
    input.userId,
  );
  const client = createPilotAdminClient();
  const { error } = await client
    .from("timetable_sessions")
    .delete()
    .eq("id", input.sessionId)
    .eq("timetable_version_id", versionId);
  if (error) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not delete the timetable session.",
      503,
      error,
    );
  }
}

export async function publishTimetable(timetableId: string, userId: string) {
  const versionId = await getEditableVersion(timetableId, userId);
  const editor = await getTimetableEditor(timetableId, userId);
  if (!editor.timetable.academicPeriodStartsOn || !editor.timetable.academicPeriodEndsOn) {
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Academic period dates are required before publishing.",
      422,
    );
  }

  const client = createPilotAdminClient();
  const { data, error } = await client.rpc("publish_timetable_version", {
    p_timetable_id: timetableId,
    p_version_id: versionId,
    p_published_by: userId,
  });
  if (error) {
    const message =
      error.message.includes("TIMETABLE_EMPTY")
        ? "Add at least one class session before publishing."
        : error.message.includes("TIMETABLE_CONFLICT")
          ? "Resolve timetable overlaps before publishing."
          : "Could not publish the timetable.";
    throw new PilotApiError("PUBLISH_FAILED", message, 422, error);
  }
  const record = Array.isArray(data) ? data[0] : data;
  return {
    publicSlug: String(record.public_slug),
    versionNumber: Number(record.version_number),
    sessionCount: Number(record.session_count),
    publishedAt: String(record.published_at),
  };
}

async function getPublishedTimetable(
  filter: { publicSlug?: string; timetableId?: string },
) {
  const client = createPilotAdminClient();
  let query = client
    .from("timetables")
    .select("id, public_slug, current_published_version_id, institutions(name, timezone), programmes(name), cohorts(label), academic_periods(name, starts_on, ends_on)")
    .not("current_published_version_id", "is", null);
  if (filter.publicSlug) query = query.eq("public_slug", filter.publicSlug);
  if (filter.timetableId) query = query.eq("id", filter.timetableId);
  const timetable = await expectData(
    query.maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the published timetable.",
  );
  if (!timetable) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable has not been published yet.",
      404,
    );
  }

  const publishedVersionId = String((timetable as JsonRecord).current_published_version_id);
  const version = await expectData<JsonRecord | null>(
    client
      .from("timetable_versions")
      .select("id, version_number, published_at")
      .eq("id", publishedVersionId)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the published timetable version.",
  );
  if (!version) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable has not been published yet.",
      404,
    );
  }

  const sessions = await expectData(
    client
      .from("timetable_sessions")
      .select("stable_session_key, course_code, course_name, weekday, start_time, end_time, venue, lecturer, session_type, notes")
      .eq("timetable_version_id", publishedVersionId)
      .order("weekday")
      .order("start_time"),
    "DATABASE_UNAVAILABLE",
    "Could not load timetable sessions.",
  );

  const timetableRecord = timetable as JsonRecord;
  const versionRecord = version as JsonRecord;
  const institution = asSingle(timetableRecord.institutions as JsonRecord | JsonRecord[] | null);
  const programme = asSingle(timetableRecord.programmes as JsonRecord | JsonRecord[] | null);
  const cohort = asSingle(timetableRecord.cohorts as JsonRecord | JsonRecord[] | null);
  const period = asSingle(timetableRecord.academic_periods as JsonRecord | JsonRecord[] | null);

  return {
    timetableId: String(timetableRecord.id),
    publicSlug: String(timetableRecord.public_slug),
    institution: institution?.name ? String(institution.name) : "",
    institutionTimezone: institution?.timezone ? String(institution.timezone) : "Africa/Harare",
    programme: programme?.name ? String(programme.name) : "",
    classGroup: cohort?.label ? String(cohort.label) : "",
    academicPeriod: period?.name ? String(period.name) : "",
    startsOn: period?.starts_on ? String(period.starts_on) : null,
    endsOn: period?.ends_on ? String(period.ends_on) : null,
    publishedAt: versionRecord.published_at ? String(versionRecord.published_at) : null,
    versionNumber: Number(versionRecord.version_number ?? 1),
    sessions: (sessions ?? []).map((row: unknown) => ({
      stableSessionKey: String((row as JsonRecord).stable_session_key),
      courseCode: String((row as JsonRecord).course_code),
      courseName: String((row as JsonRecord).course_name),
      weekday: Number((row as JsonRecord).weekday),
      startTime: String((row as JsonRecord).start_time),
      endTime: String((row as JsonRecord).end_time),
      venue: (row as JsonRecord).venue ? String((row as JsonRecord).venue) : null,
      lecturer: (row as JsonRecord).lecturer ? String((row as JsonRecord).lecturer) : null,
      sessionType:
        (row as JsonRecord).session_type ? String((row as JsonRecord).session_type) : null,
      notes: (row as JsonRecord).notes ? String((row as JsonRecord).notes) : null,
    })) satisfies PublicTimetableSession[],
  } satisfies PublicTimetable;
}

export async function getPublishedTimetableBySlug(publicSlug: string) {
  return getPublishedTimetable({ publicSlug });
}

export async function getPublishedTimetableById(timetableId: string) {
  return getPublishedTimetable({ timetableId });
}

export async function createCalendarSubscriptionRecord(input: {
  timetableId: string;
  provider: string;
  reminderPreset: string;
  reminderOffsetsMinutes: number[];
  timezone: string;
  anonymousSessionId?: string;
  rawToken?: string;
  tokenHash?: string;
}) {
  const timetable = await getPublishedTimetableById(input.timetableId);

  const client = createPilotAdminClient();
  const data = await expectData(
    client
      .from("calendar_subscriptions")
      .insert({
        timetable_id: input.timetableId,
        anonymous_session_id: input.anonymousSessionId ?? null,
        provider: input.provider,
        reminder_preset: input.reminderPreset,
        reminder_offsets_minutes: input.reminderOffsetsMinutes,
        calendar_name: `${timetable.programme} - ${timetable.academicPeriod.replace(",", "")}`,
        timezone: input.timezone,
        token_hash: input.tokenHash ?? null,
        status: "active",
      })
      .select("*")
      .single(),
    "DATABASE_UNAVAILABLE",
    "Could not create the calendar subscription.",
  );
  return data as unknown as JsonRecord;
}

export async function getCalendarSubscriptionById(id: string) {
  const client = createPilotAdminClient();
  return expectData(
    client.from("calendar_subscriptions").select("*").eq("id", id).maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the calendar subscription.",
  );
}

export async function getCalendarSubscriptionByTokenHash(tokenHash: string) {
  const client = createPilotAdminClient();
  return expectData(
    client
      .from("calendar_subscriptions")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle(),
    "DATABASE_UNAVAILABLE",
    "Could not load the calendar subscription.",
  );
}
