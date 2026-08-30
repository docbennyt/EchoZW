import type {
  PublicTimetable,
  PublicTimetableSession,
} from "../api/pilotTypes.js";
import {
  assertIanaTimeZone,
  formatIcsLocalDateTime,
  formatIcsUtc,
  zonedDateTimeToUtc,
} from "./timezone.js";

const weekdayMap: Record<number, string> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

export type CanonicalCalendarAlarm = {
  minutesBefore: number;
  description: string;
};

export type CanonicalPublishedCalendarEvent = {
  stableSessionKey: string;
  uid: string;
  weekday: number;
  recurrenceDay: string;
  firstDate: string;
  startTime: string;
  endTime: string;
  localStart: string;
  localEnd: string;
  firstStartUtc: string;
  firstEndUtc: string;
  recurrenceUntilUtc: string;
  courseCode: string;
  courseName: string;
  summary: string;
  description: string;
  venue: string;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
  lastModifiedUtc: string;
  sequence: number;
  alarms: CanonicalCalendarAlarm[];
};

export type CanonicalPublishedCalendar = {
  calendarName: string;
  timezone: string;
  startsOn: string;
  endsOn: string;
  publishedAt: string;
  versionNumber: number;
  publicUrl: string;
  events: CanonicalPublishedCalendarEvent[];
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid academic date: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

function toTimetableWeekday(date: Date) {
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function firstOccurrenceDate(startDate: string, weekday: number) {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error(`Invalid timetable weekday: ${weekday}`);
  }
  const { year, month, day } = parseDateKey(startDate);
  const date = new Date(Date.UTC(year, month - 1, day));
  const currentWeekday = toTimetableWeekday(date);
  const delta = (weekday - currentWeekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return formatDateKey(date);
}

function timeToSeconds(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Invalid timetable time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid timetable time: ${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function normalizeClassLabel(value: string) {
  const trimmed = value.trim();
  return /^class\s+/i.test(trimmed) ? trimmed : `Class ${trimmed}`;
}

function alarmDescription(courseName: string, minutes: number) {
  if (minutes === 1440) return `${courseName} starts in 24 hours`;
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${courseName} starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${courseName} starts in ${minutes} minutes`;
}

function eventDescription(
  timetable: PublicTimetable,
  session: PublicTimetableSession,
  publicUrl: string,
) {
  return [
    `Course: ${session.courseName}`,
    `Code: ${session.courseCode}`,
    `Class: ${normalizeClassLabel(timetable.classGroup)}`,
    `Academic period: ${timetable.academicPeriod}`,
    session.lecturer ? `Lecturer: ${session.lecturer}` : undefined,
    session.sessionType ? `Session type: ${session.sessionType}` : undefined,
    session.notes ? `Notes: ${session.notes}` : undefined,
    `CalenderZW timetable: ${publicUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizePublicOrigin(value: string) {
  const parsed = new URL(value);
  return parsed.origin.replace(/\/$/, "");
}

export function projectPublishedTimetable(input: {
  timetable: PublicTimetable;
  reminderOffsetsMinutes?: number[];
  publicOrigin?: string;
}): CanonicalPublishedCalendar {
  const timetable = input.timetable;
  if (!timetable.startsOn || !timetable.endsOn) {
    throw new Error("Published timetable is missing academic period dates.");
  }
  if (timetable.startsOn > timetable.endsOn) {
    throw new Error("Published timetable academic period is invalid.");
  }
  if (!timetable.publishedAt) {
    throw new Error("Published timetable is missing publication timestamp.");
  }
  if (!Number.isInteger(timetable.versionNumber) || timetable.versionNumber < 1) {
    throw new Error("Published timetable version number is invalid.");
  }

  const timezone = assertIanaTimeZone(timetable.institutionTimezone);
  const publicOrigin = normalizePublicOrigin(
    input.publicOrigin ?? "https://calender.aido.co.zw",
  );
  const publicUrl = `${publicOrigin}/t/${encodeURIComponent(timetable.publicSlug)}`;
  const reminderOffsets = [
    ...new Set(
      (input.reminderOffsetsMinutes ?? []).filter(
        (value) => Number.isInteger(value) && value > 0,
      ),
    ),
  ].sort((left, right) => right - left);
  const recurrenceUntilUtc = formatIcsUtc(
    zonedDateTimeToUtc(timetable.endsOn, "23:59:59", timezone),
  );
  const lastModifiedUtc = formatIcsUtc(new Date(timetable.publishedAt));

  const events = timetable.sessions.map((session) => {
    if (!session.stableSessionKey.trim()) {
      throw new Error("Published timetable session is missing stable identity.");
    }
    if (!weekdayMap[session.weekday]) {
      throw new Error(`Invalid timetable weekday: ${session.weekday}`);
    }
    if (timeToSeconds(session.endTime) <= timeToSeconds(session.startTime)) {
      throw new Error(
        `Published timetable session ${session.stableSessionKey} must end after it starts.`,
      );
    }

    const firstDate = firstOccurrenceDate(
      timetable.startsOn as string,
      session.weekday,
    );
    const firstStartUtc = zonedDateTimeToUtc(
      firstDate,
      session.startTime,
      timezone,
    );
    const firstEndUtc = zonedDateTimeToUtc(
      firstDate,
      session.endTime,
      timezone,
    );

    return {
      stableSessionKey: session.stableSessionKey,
      uid: `${session.stableSessionKey}@calender.aido.co.zw`,
      weekday: session.weekday,
      recurrenceDay: weekdayMap[session.weekday],
      firstDate,
      startTime: session.startTime,
      endTime: session.endTime,
      localStart: formatIcsLocalDateTime(firstDate, session.startTime),
      localEnd: formatIcsLocalDateTime(firstDate, session.endTime),
      firstStartUtc: firstStartUtc.toISOString(),
      firstEndUtc: firstEndUtc.toISOString(),
      recurrenceUntilUtc,
      courseCode: session.courseCode,
      courseName: session.courseName,
      summary: `${session.courseCode} · ${session.courseName}`,
      description: eventDescription(timetable, session, publicUrl),
      venue: session.venue ?? "",
      lecturer: session.lecturer,
      sessionType: session.sessionType,
      notes: session.notes,
      lastModifiedUtc,
      sequence: timetable.versionNumber,
      alarms: reminderOffsets.map((minutesBefore) => ({
        minutesBefore,
        description: alarmDescription(session.courseName, minutesBefore),
      })),
    } satisfies CanonicalPublishedCalendarEvent;
  });

  return {
    calendarName: `${normalizeClassLabel(timetable.classGroup)} · CalenderZW`,
    timezone,
    startsOn: timetable.startsOn,
    endsOn: timetable.endsOn,
    publishedAt: timetable.publishedAt,
    versionNumber: timetable.versionNumber,
    publicUrl,
    events,
  };
}
