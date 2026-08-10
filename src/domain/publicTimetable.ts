import type { PublicTimetable, PublicTimetableSession } from "../api/pilotTypes.js";

const weekdayLabels = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const weekdayShortToIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type UpcomingTimetableOccurrence = {
  session: PublicTimetableSession;
  start: Date;
  end: Date;
  dateKey: string;
  relativeLabel: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addDaysToYmd(value: string, amount: number) {
  const { year, month, day } = parseYmd(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const zoneName = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const { year, month, day } = parseYmd(dateKey);
  const [hours, minutes, seconds] = time.split(":").map(Number);
  const baseUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds ?? 0);
  let candidate = new Date(baseUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getOffsetMinutes(candidate, timeZone);
    const next = new Date(baseUtc - offsetMinutes * 60_000);
    if (next.getTime() === candidate.getTime()) return next;
    candidate = next;
  }

  return candidate;
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekdayIndex: weekdayShortToIndex[values.weekday] ?? 0,
  };
}

function getWeekdayIndexForDateKey(dateKey: string, timeZone: string) {
  const midday = zonedDateTimeToUtc(dateKey, "12:00:00", timeZone);
  return getZonedParts(midday, timeZone).weekdayIndex;
}

function toTimetableWeekday(dateKey: string, timeZone: string) {
  const weekdayIndex = getWeekdayIndexForDateKey(dateKey, timeZone);
  return weekdayIndex === 0 ? 7 : weekdayIndex;
}

function getRelativeLabel(dateKey: string, timeZone: string, now: Date) {
  const today = getZonedParts(now, timeZone).dateKey;
  const tomorrow = addDaysToYmd(today, 1);
  if (dateKey === today) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  return weekdayLabels[getWeekdayIndexForDateKey(dateKey, timeZone)];
}

export function formatClassGroupLabel(value: string) {
  return /^class\s+/i.test(value) ? value : `Class ${value}`;
}

export function getInstitutionIdentity(timetable: PublicTimetable) {
  return timetable.institutionShortName?.trim() || timetable.institution;
}

export function formatPublishedTimestamp(value: string | null, timeZone: string) {
  if (!value) return "Publication time unavailable";
  return new Intl.DateTimeFormat("en-ZW", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatOccurrenceTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-ZW", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildPublicTimetableMetadata(timetable: PublicTimetable) {
  const institution = getInstitutionIdentity(timetable);
  return {
    title: `${institution} · ${timetable.programme} · ${formatClassGroupLabel(timetable.classGroup)}`,
    description: `${timetable.academicPeriod} published timetable. View your classes and add them to your calendar with CalenderZW.`,
    canonicalPath: `/t/${timetable.publicSlug}`,
  };
}

export function getUpcomingOccurrences(
  timetable: PublicTimetable,
  now = new Date(),
  limit = 3,
): UpcomingTimetableOccurrence[] {
  if (!timetable.startsOn || !timetable.endsOn || timetable.startsOn > timetable.endsOn) {
    return [];
  }

  const timeZone = timetable.institutionTimezone || "Africa/Harare";
  const today = getZonedParts(now, timeZone).dateKey;
  const occurrences: UpcomingTimetableOccurrence[] = [];

  for (let dayOffset = 0; dayOffset <= 21 && occurrences.length < limit * 3; dayOffset += 1) {
    const dateKey = addDaysToYmd(today, dayOffset);
    if (dateKey < timetable.startsOn || dateKey > timetable.endsOn) continue;

    const weekday = toTimetableWeekday(dateKey, timeZone);
    const sessions = timetable.sessions.filter(
      (session: PublicTimetableSession) => session.weekday === weekday,
    );

    for (const session of sessions) {
      const start = zonedDateTimeToUtc(dateKey, session.startTime, timeZone);
      const end = zonedDateTimeToUtc(dateKey, session.endTime, timeZone);
      if (start < now) continue;

      occurrences.push({
        session,
        start,
        end,
        dateKey,
        relativeLabel: getRelativeLabel(dateKey, timeZone, now),
      });
    }
  }

  return occurrences
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .slice(0, limit);
}
