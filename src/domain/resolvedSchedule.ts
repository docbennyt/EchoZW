import type {
  PublicTimetable,
  PublicTimetableSession,
  TimetableCorrectionDirective,
  TimetableSessionException,
} from "../api/pilotTypes.js";
import { zonedDateTimeToUtc } from "./timezone.js";

export type ResolvedScheduleSession = PublicTimetableSession & {
  source: "published" | "correction" | "exception";
  correctionId?: string;
  exceptionId?: string;
  occurrenceDate?: string;
};

export type ResolvedScheduleOccurrence = {
  session: ResolvedScheduleSession;
  start: Date;
  end: Date;
  dateKey: string;
  recurring: boolean;
};

const weekdayShortToTimetable: Record<string, number> = {
  Sun: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function addDaysToDateKey(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function zonedDateParts(instant: Date, timeZone: string) {
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

function normalizeTime(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function stableCorrectionKey(correction: TimetableCorrectionDirective) {
  return `correction-${correction.id}`;
}

function materializeCorrection(
  correction: TimetableCorrectionDirective,
): ResolvedScheduleSession | null {
  const startTime = normalizeTime(correction.startTime);
  const endTime = normalizeTime(correction.endTime);
  if (
    !correction.courseCode ||
    !correction.courseName ||
    !correction.weekday ||
    !startTime ||
    !endTime
  ) {
    return null;
  }

  return {
    stableSessionKey:
      correction.stableSessionKey || stableCorrectionKey(correction),
    courseCode: correction.courseCode,
    courseName: correction.courseName,
    weekday: correction.weekday,
    startTime,
    endTime,
    venue: correction.venue,
    lecturer: correction.lecturer,
    sessionType: correction.sessionType,
    notes: correction.notes,
    source: "correction",
    correctionId: correction.id,
  };
}

export function resolveRecurringSessions(
  timetable: PublicTimetable,
): ResolvedScheduleSession[] {
  const sessions = new Map<string, ResolvedScheduleSession>();
  for (const session of timetable.sessions) {
    sessions.set(session.stableSessionKey, { ...session, source: "published" });
  }

  const corrections = (timetable.corrections ?? [])
    .filter((correction) => correction.active)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const correction of corrections) {
    const targetKey = correction.stableSessionKey;
    if (correction.action === "remove") {
      if (targetKey) sessions.delete(targetKey);
      continue;
    }

    const materialized = materializeCorrection(correction);
    if (!materialized) continue;

    if (correction.action === "modify" && targetKey) {
      sessions.set(targetKey, {
        ...materialized,
        stableSessionKey: targetKey,
      });
      continue;
    }

    sessions.set(materialized.stableSessionKey, materialized);
  }

  return [...sessions.values()].sort((left, right) => {
    if (left.weekday !== right.weekday) return left.weekday - right.weekday;
    return left.startTime.localeCompare(right.startTime);
  });
}

function buildExtraSession(
  exception: TimetableSessionException,
  timeZone: string,
): ResolvedScheduleOccurrence | null {
  const startTime = normalizeTime(exception.startTime);
  const endTime = normalizeTime(exception.endTime);
  if (
    !exception.courseCode ||
    !exception.courseName ||
    !startTime ||
    !endTime
  ) {
    return null;
  }
  const session: ResolvedScheduleSession = {
    stableSessionKey: `extra-${exception.id}`,
    courseCode: exception.courseCode,
    courseName: exception.courseName,
    weekday: weekdayForLocalDate(exception.exceptionDate, timeZone),
    startTime,
    endTime,
    venue: exception.venue,
    lecturer: exception.lecturer,
    sessionType: exception.sessionType,
    notes: exception.notes,
    source: "exception",
    exceptionId: exception.id,
    occurrenceDate: exception.exceptionDate,
  };
  return {
    session,
    start: zonedDateTimeToUtc(exception.exceptionDate, startTime, timeZone),
    end: zonedDateTimeToUtc(exception.exceptionDate, endTime, timeZone),
    dateKey: exception.exceptionDate,
    recurring: false,
  };
}

function movedOccurrence(
  session: ResolvedScheduleSession,
  exception: TimetableSessionException,
  timeZone: string,
) {
  if (!exception.replacementStartsAt || !exception.replacementEndsAt) {
    return null;
  }
  const start = new Date(exception.replacementStartsAt);
  const end = new Date(exception.replacementEndsAt);
  const dateKey = zonedDateParts(start, timeZone).dateKey;
  const startTime = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}:00`;
  const endTime = `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}:00`;
  return {
    session: {
      ...session,
      stableSessionKey: `${session.stableSessionKey}-moved-${exception.id}`,
      startTime,
      endTime,
      source: "exception" as const,
      exceptionId: exception.id,
      occurrenceDate: dateKey,
      notes: exception.notes ?? session.notes,
    },
    start,
    end,
    dateKey,
    recurring: false,
  };
}

export function resolveScheduleForDate(
  timetable: PublicTimetable,
  dateKey: string,
): ResolvedScheduleOccurrence[] {
  const timeZone = timetable.institutionTimezone || "Africa/Harare";
  if (timetable.startsOn && dateKey < timetable.startsOn) return [];
  if (timetable.endsOn && dateKey > timetable.endsOn) return [];

  const weekday = weekdayForLocalDate(dateKey, timeZone);
  const recurring = resolveRecurringSessions(timetable).filter(
    (session) => session.weekday === weekday,
  );
  const exceptions = (timetable.exceptions ?? []).filter(
    (exception) => exception.active && exception.exceptionDate === dateKey,
  );
  const exceptionByStableKey = new Map(
    exceptions
      .filter((exception) => exception.stableSessionKey)
      .map((exception) => [exception.stableSessionKey as string, exception]),
  );
  const occurrences: ResolvedScheduleOccurrence[] = [];

  for (const session of recurring) {
    const exception = exceptionByStableKey.get(session.stableSessionKey);
    if (exception?.exceptionType === "cancelled") continue;
    if (exception?.exceptionType === "moved") {
      const moved = movedOccurrence(session, exception, timeZone);
      if (moved) occurrences.push(moved);
      continue;
    }
    occurrences.push({
      session,
      start: zonedDateTimeToUtc(dateKey, session.startTime, timeZone),
      end: zonedDateTimeToUtc(dateKey, session.endTime, timeZone),
      dateKey,
      recurring: true,
    });
  }

  for (const exception of exceptions) {
    if (exception.exceptionType !== "extra") continue;
    const extra = buildExtraSession(exception, timeZone);
    if (extra) occurrences.push(extra);
  }

  return occurrences.sort(
    (left, right) => left.start.getTime() - right.start.getTime(),
  );
}

export function getResolvedUpcomingOccurrences(
  timetable: PublicTimetable,
  now = new Date(),
  limit = 3,
): ResolvedScheduleOccurrence[] {
  const timeZone = timetable.institutionTimezone || "Africa/Harare";
  const today = zonedDateParts(now, timeZone).dateKey;
  const occurrences: ResolvedScheduleOccurrence[] = [];

  for (
    let dayOffset = 0;
    dayOffset <= 21 && occurrences.length < limit * 3;
    dayOffset += 1
  ) {
    const dateKey = addDaysToDateKey(today, dayOffset);
    for (const occurrence of resolveScheduleForDate(timetable, dateKey)) {
      if (occurrence.start >= now) occurrences.push(occurrence);
    }
  }

  return occurrences
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .slice(0, limit);
}
