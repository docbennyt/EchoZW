import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { PilotApiError } from "./pilotRepository.js";

type CalendarRevision = {
  publishedVersionId: string;
  updatedAt: string;
  sequence: number;
};

export async function getCalendarRevision(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CalendarRevision> {
  const client = createSupabaseAdminClient(env);
  const { data: timetable, error: timetableError } = await client
    .from("timetables")
    .select("id, current_published_version_id")
    .eq("id", timetableId)
    .maybeSingle();

  if (timetableError) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not resolve the calendar revision.",
      503,
    );
  }
  if (!timetable?.current_published_version_id) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable does not have a published calendar yet.",
      404,
    );
  }

  const { data: clock, error: clockError } = await client
    .from("google_calendar_delivery_revisions")
    .select("revision, updated_at")
    .eq("timetable_id", timetableId)
    .maybeSingle();
  if (clockError) {
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not resolve the calendar revision.",
      503,
    );
  }

  const rawSequence = clock?.revision;
  const sequence =
    typeof rawSequence === "number" ||
    (typeof rawSequence === "string" && /^[1-9]\d*$/.test(rawSequence))
      ? Number(rawSequence)
      : Number.NaN;
  const updatedAt =
    typeof clock?.updated_at === "string"
      ? Date.parse(clock.updated_at)
      : Number.NaN;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > 2147483647 ||
    !Number.isFinite(updatedAt)
  ) {
    throw new PilotApiError(
      "CALENDAR_REVISION_UNAVAILABLE",
      "The calendar revision is temporarily unavailable.",
      503,
    );
  }
  return {
    publishedVersionId: String(timetable.current_published_version_id),
    updatedAt: new Date(updatedAt).toISOString(),
    sequence,
  };
}
