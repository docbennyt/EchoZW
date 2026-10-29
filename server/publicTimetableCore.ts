import {
  getPublishedTimetableBySlug,
  listPublishedTimetableDiscovery,
} from "./pilotRepository.js";
import { getTimetablePublicDisplaySettings } from "./timetablePublicSettingsRepository.js";
import { resolveRecurringSessions } from "../src/domain/resolvedSchedule.js";

export async function listPublicTimetableDiscoveryResponse(
  env?: NodeJS.ProcessEnv,
) {
  const timetables = (await listPublishedTimetableDiscovery(env)).map(
    (timetable) => ({
      publicSlug: timetable.publicSlug,
      institutionName: timetable.institutionName,
      timezone: timetable.institutionTimezone,
      programmeName: timetable.programmeName,
      classGroupLabel: timetable.classGroupLabel,
      academicPeriodName: timetable.academicPeriodName,
      startsOn: timetable.academicPeriodStartsOn,
      endsOn: timetable.academicPeriodEndsOn,
      lastUpdated: timetable.lastUpdated,
    }),
  );
  return { timetables };
}

export async function getPublicTimetableResponse(
  publicSlug: string,
  env?: NodeJS.ProcessEnv,
) {
  const timetable = await getPublishedTimetableBySlug(publicSlug, env);
  const publicDisplay = await getTimetablePublicDisplaySettings(
    timetable.timetableId,
    env,
  );
  return {
    timetable: {
      ...timetable,
      publicDisplay,
      effectiveSessions: resolveRecurringSessions(timetable),
    },
  };
}
