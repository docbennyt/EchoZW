import { generatePublishedTimetableIcs } from "./publishedCalendar.js";
import { loadPublishedTimetableSnapshot } from "./publishedTimetableSnapshot.js";

export async function buildRevisionAwareCalendar(input: {
  timetableId: string;
  reminders: number[];
  examReminders?: number[];
  publicOrigin: string;
  env: NodeJS.ProcessEnv;
}) {
  const { timetable, revision } = await loadPublishedTimetableSnapshot(
    input.timetableId,
    input.env,
  );
  const resolvedTimetable = {
    ...timetable,
    publishedAt: revision.updatedAt,
    versionNumber: revision.sequence,
  };
  const ics = generatePublishedTimetableIcs({
    timetable: resolvedTimetable,
    reminderOffsetsMinutes: input.reminders,
    examReminderOffsetsMinutes: input.examReminders,
    publicOrigin: input.publicOrigin,
  });
  return { ics, revision };
}
