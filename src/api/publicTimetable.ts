import type { PublicTimetable } from "./pilotTypes";

export async function fetchPublicTimetable(publicSlug: string) {
  const response = await fetch(
    `/api/public/timetables/${encodeURIComponent(publicSlug)}`,
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

  return body.timetable;
}
