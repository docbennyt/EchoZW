import type { PublicTimetable } from "./pilotTypes";
import { resolveRecurringSessions } from "../domain/resolvedSchedule";

/**
 * Fetch the current public timetable and materialize its active recurring
 * correction directives before handing it to UI consumers.
 *
 * The server intentionally preserves published/source-backed sessions plus an
 * auditable correction overlay. Client surfaces, however, must render the
 * effective recurring schedule. Keeping that resolution at this shared fetch
 * boundary prevents individual timetable screens from accidentally rendering
 * raw source rows and makes Class Rep/public views agree.
 */
export async function fetchPublicTimetable(publicSlug: string) {
  const response = await fetch(
    `/api/public/timetables/${encodeURIComponent(publicSlug)}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );
  const body = (await response.json().catch(() => null)) as {
    timetable?: PublicTimetable;
    error?: { message?: string; code?: string };
  } | null;

  if (!response.ok || !body?.timetable) {
    const error = new Error(
      body?.error?.message ?? "This timetable is not available right now.",
    );
    error.name = body?.error?.code ?? "TIMETABLE_UNAVAILABLE";
    throw error;
  }

  const timetable = body.timetable;
  return {
    ...timetable,
    sessions: resolveRecurringSessions(timetable),
  } satisfies PublicTimetable;
}
