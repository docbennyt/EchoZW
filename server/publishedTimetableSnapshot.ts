import { getCalendarRevision } from "./calendarRevisionRepository.js";
import { getPublishedTimetableById, PilotApiError } from "./pilotRepository.js";

export async function loadPublishedTimetableSnapshot(
  timetableId: string,
  env: NodeJS.ProcessEnv,
) {
  // A changed clock invalidates the entire multi-query read, not just its stamp.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await getCalendarRevision(timetableId, env);
    const timetable = await getPublishedTimetableById(timetableId, env);
    if (!timetable.publishedAt) {
      throw new PilotApiError(
        "TIMETABLE_NOT_PUBLISHED",
        "This timetable does not have a published calendar yet.",
        404,
      );
    }
    const after = await getCalendarRevision(timetableId, env);
    if (
      before.sequence === after.sequence &&
      before.publishedVersionId === after.publishedVersionId &&
      before.updatedAt === after.updatedAt
    ) {
      return { timetable, revision: after };
    }
  }
  throw new PilotApiError(
    "CALENDAR_REVISION_UNSTABLE",
    "The timetable is changing. Please try again shortly.",
    503,
  );
}
