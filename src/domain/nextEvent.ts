import type { AcademicCalendarEvent, Timetable } from "./types.js";

const weekdayByIcs = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function withTime(date: Date, time: string) {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, seconds ?? 0, 0);
  return next;
}

export function expandNextOccurrence(
  event: AcademicCalendarEvent,
  now = new Date(),
) {
  const firstStart = new Date(event.startsAtLocal);
  const firstEnd = new Date(event.endsAtLocal);
  const until = event.recurrence
    ? new Date(`${event.recurrence.until}T23:59:59`)
    : firstEnd;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDay = new Date(now);
    candidateDay.setDate(now.getDate() + dayOffset);
    const weekday = weekdayByIcs[candidateDay.getDay()];
    const isMatchingDay = event.recurrence
      ? event.recurrence.weekdays.includes(weekday as never)
      : candidateDay.toDateString() === firstStart.toDateString();
    if (!isMatchingDay) continue;

    const start = withTime(candidateDay, event.startsAtLocal.slice(11));
    const end = withTime(candidateDay, event.endsAtLocal.slice(11));
    const excluded = event.exclusions?.includes(
      start.toISOString().slice(0, 10),
    );
    if (!excluded && start >= now && start >= firstStart && start <= until) {
      return { event, start, end };
    }
  }
  return null;
}

export function getNextEvent(timetable: Timetable, now = new Date()) {
  return timetable.events
    .filter((event) => event.status !== "cancelled")
    .map((event) => expandNextOccurrence(event, now))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
}

export function formatLectureTime(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-ZW", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeOnly = new Intl.DateTimeFormat("en-ZW", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(start)}-${timeOnly.format(end)}`;
}
