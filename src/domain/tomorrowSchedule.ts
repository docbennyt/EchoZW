import type {
  PublicTimetable,
  PublicTimetableSession,
} from "../api/pilotTypes";
import { zonedDateTimeToUtc } from "./timezone";

const weekdayShortToTimetable: Record<string, number> = {
  Sun: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

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

function zonedDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekday: weekdayShortToTimetable[values.weekday] ?? 7,
  };
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
  const startsBeforeTomorrow =
    !timetable.startsOn || institutionDateTomorrow >= timetable.startsOn;
  const endsAfterTomorrow =
    !timetable.endsOn || institutionDateTomorrow <= timetable.endsOn;

  const sessions =
    !startsBeforeTomorrow || !endsAfterTomorrow
      ? []
      : timetable.sessions
          .filter((session) => session.weekday === tomorrowWeekday)
          .map((session) => ({
            session,
            start: zonedDateTimeToUtc(
              institutionDateTomorrow,
              session.startTime,
              timeZone,
            ),
            end: zonedDateTimeToUtc(
              institutionDateTomorrow,
              session.endTime,
              timeZone,
            ),
          }))
          .sort((left, right) => left.start.getTime() - right.start.getTime());

  return {
    institutionDateToday,
    institutionDateTomorrow,
    tomorrowWeekday,
    tomorrowLabel: formatTomorrowLabel(institutionDateTomorrow, timeZone),
    sessions,
  };
}
