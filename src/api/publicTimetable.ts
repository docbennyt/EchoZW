import type { PublicTimetable } from "./pilotTypes";
import { selectEffectiveRecurringSessions } from "../domain/resolvedSchedule";

export async function fetchPublicTimetable(
  publicSlug: string,
): Promise<PublicTimetable> {
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

  return {
    ...body.timetable,
    effectiveSessions: selectEffectiveRecurringSessions(body.timetable),
  } satisfies PublicTimetable;
}
