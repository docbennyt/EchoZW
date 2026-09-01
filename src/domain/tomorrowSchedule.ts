import type {
  PublicTimetable,
  PublicTimetableSession,
} from "../api/pilotTypes.js";
import { resolveScheduleForDate, zonedDateParts } from "./resolvedSchedule.js";
import { zonedDateTimeToUtc } from "./timezone.js";

export type TomorrowScheduleSession = {
  session: PublicTimetableSession;
  start: Date;
  end: Date;
};

export type TomorrowSchedule = {
  institutionDateToday: string;
  institutionDateTomorrow: string;
  tomorrowWeekday: number;
  tomorrowLabel: string;
  sessions: TomorrowScheduleSession[];
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function addDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekdayForLocalDate(dateKey: string, timeZone: string) {
  const middayUtc = zonedDateTimeToUtc(dateKey, "12:00:00", timeZone);
  return zonedDateParts(middayUtc, timeZone).weekday;
}

function formatTomorrowLabel(dateKey: string, timeZone: string) {
  const middayUtc = zonedDateTimeToUtc(dateKey, "12:00:00", timeZone);
  return new Intl.DateTimeFormat("en-ZW", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(middayUtc);
}

export function getTomorrowSchedule(
  timetable: PublicTimetable,
  now = new Date(),
): TomorrowSchedule {
  const timeZone = timetable.institutionTimezone || "Africa/Harare";
  const institutionDateToday = zonedDateParts(now, timeZone).dateKey;
  const institutionDateTomorrow = addDays(institutionDateToday, 1);
  const tomorrowWeekday = weekdayForLocalDate(
    institutionDateTomorrow,
    timeZone,
  );
  const sessions = resolveScheduleForDate(
    timetable,
    institutionDateTomorrow,
  ).map((occurrence) => ({
    session: occurrence.session,
    start: occurrence.start,
    end: occurrence.end,
  }));

  return {
    institutionDateToday,
    institutionDateTomorrow,
    tomorrowWeekday,
    tomorrowLabel: formatTomorrowLabel(institutionDateTomorrow, timeZone),
    sessions,
  };
}
