import { getCalendarRevision } from "./calendarRevisionRepository.js";
import { generatePublishedTimetableIcs } from "./publishedCalendar.js";
import { getPublishedTimetableById, PilotApiError } from "./pilotRepository.js";

export async function buildRevisionAwareCalendar(input: {
  timetableId: string;
  reminders: number[];
  publicOrigin: string;
  env: NodeJS.ProcessEnv;
}) {
  const timetable = await getPublishedTimetableById(
    input.timetableId,
    input.env,
  );
  if (!timetable.publishedAt) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable does not have a published calendar yet.",
      404,
    );
  }
  const revision = await getCalendarRevision(input.timetableId, input.env);
  const resolvedTimetable = {
    ...timetable,
    publishedAt: revision.updatedAt,
    versionNumber: revision.sequence,
  };
  const ics = generatePublishedTimetableIcs({
    timetable: resolvedTimetable,
    reminderOffsetsMinutes: input.reminders,
    publicOrigin: input.publicOrigin,
  });
  return { ics, revision };
}
