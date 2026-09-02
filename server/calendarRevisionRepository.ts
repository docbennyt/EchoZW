import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { PilotApiError } from "./pilotRepository.js";

type JsonRecord = Record<string, unknown>;

type CalendarRevision = {
  updatedAt: string;
  sequence: number;
};

function asTime(value: unknown) {
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function maxIso(values: unknown[], fallback: string) {
  const max = Math.max(asTime(fallback), ...values.map(asTime));
  return new Date(max).toISOString();
}

export async function getCalendarRevision(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarRevision> {
  const client = createSupabaseAdminClient(env);
  const { data: timetable, error: timetableError } = await client
    .from("timetables")
    .select("id, updated_at, current_published_version_id")
    .eq("id", timetableId)
    .maybeSingle();

  if (timetableError) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not resolve the calendar revision.",
      503,
      timetableError,
    );
  }
  if (!timetable?.current_published_version_id) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable does not have a published calendar yet.",
      404,
    );
  }

  const [versionResult, correctionResult, exceptionResult] = await Promise.all([
    client
      .from("timetable_versions")
      .select("version_number, published_at, created_at")
      .eq("id", timetable.current_published_version_id)
      .maybeSingle(),
    client
      .from("timetable_correction_directives")
      .select("created_at, updated_at, revoked_at, superseded_at")
      .eq("timetable_id", timetableId),
    client
      .from("timetable_session_exceptions")
      .select("created_at, revoked_at")
      .eq("timetable_id", timetableId),
  ]);

  const firstError =
    versionResult.error ?? correctionResult.error ?? exceptionResult.error;
  if (firstError) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not resolve the calendar revision.",
      503,
      firstError,
    );
  }

  const version = versionResult.data as JsonRecord | null;
  if (!version) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable does not have a published calendar yet.",
      404,
    );
  }

  const corrections = (correctionResult.data ?? []) as JsonRecord[];
  const exceptions = (exceptionResult.data ?? []) as JsonRecord[];
  const baseVersion = Math.max(1, Number(version.version_number ?? 1));

  // This is deliberately monotonic for the append/revoke/supersede lifecycle used by
  // timetable corrections. It does not depend on wall-clock granularity.
  const sequence =
    baseVersion +
    corrections.length +
    corrections.filter((row) => Boolean(row.revoked_at)).length +
    corrections.filter((row) => Boolean(row.superseded_at)).length +
    exceptions.length +
    exceptions.filter((row) => Boolean(row.revoked_at)).length;

  const revisionTimes: unknown[] = [
    version.published_at,
    version.created_at,
    ...corrections.flatMap((row) => [
      row.created_at,
      row.updated_at,
      row.revoked_at,
      row.superseded_at,
    ]),
    ...exceptions.flatMap((row) => [row.created_at, row.revoked_at]),
  ];

  return {
    updatedAt: maxIso(revisionTimes, String(timetable.updated_at)),
    sequence,
  };
}
