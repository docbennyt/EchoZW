import type { AcademicCalendarEvent, Timetable } from "./types.js";

const pad = (value: number) => String(value).padStart(2, "0");

export function toCalendarDate(value: string, dateOnly = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  if (dateOnly) {
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  }
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function escapeIcsText(value = "") {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function foldIcsLine(line: string) {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

function localIcsDate(value: string) {
  return value.replace(/[-:]/g, "").replace(".000", "");
}

export type PersonalizedAcademicCalendar = {
  subscriptionId: string;
  calendarName: string;
  description: string;
  timezone: string;
  timetableId: string;
  timetableVersionId: string;
  reminderOffsetsMinutes: number[];
  timetable: Timetable;
};

export function createPersonalizedCalendar(input: {
  subscriptionId: string;
  calendarName?: string;
  timetable: Timetable;
  reminderOffsetsMinutes: number[];
}) {
  return {
    subscriptionId: input.subscriptionId,
    calendarName:
      input.calendarName ??
      `${input.timetable.programme} · ${input.timetable.semester.replace(",", "")}`,
    description: `${input.timetable.institution} ${input.timetable.programme} ${input.timetable.part} ${input.timetable.semester}`,
    timezone: input.timetable.timezone,
    timetableId: input.timetable.id,
    timetableVersionId: input.timetable.version,
    reminderOffsetsMinutes: [...new Set(input.reminderOffsetsMinutes)].sort(
      (a, b) => b - a,
    ),
    timetable: input.timetable,
  } satisfies PersonalizedAcademicCalendar;
}

function eventDescription(event: AcademicCalendarEvent, timetable: Timetable) {
  return [
    `Course: ${event.title}`,
    `Code: ${event.courseCode}`,
    event.lecturer
      ? `Lecturer: ${event.lecturer}`
      : "Lecturer: To be confirmed",
    event.groupName ? `Group: ${event.groupName}` : undefined,
    `Timetable: ${timetable.programme} · ${timetable.part}`,
    `Semester: ${timetable.semester}`,
    `Verification: ${event.verificationStatus.replace("_", " ")}`,
    `Version: ${timetable.version}`,
    event.description ? `Notes: ${event.description}` : undefined,
    `Source: ${timetable.source}`,
    `Report a problem: /t/${timetable.slug}/report`,
  ]
    .filter(Boolean)
    .join("\n");
}

function alarmDescription(event: AcademicCalendarEvent, minutes: number) {
  if (minutes >= 1440) return `${event.title} starts in 24 hours`;
  if (minutes >= 720) return `${event.title} starts in 12 hours`;
  if (minutes >= 60)
    return `${event.title} starts in ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${event.title} starts in ${minutes} minutes`;
}

export function generateIcsFromPersonalizedCalendar(
  calendar: PersonalizedAcademicCalendar,
) {
  const now = toCalendarDate(new Date().toISOString());
  const timetable = calendar.timetable;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//aiDo//Echo Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendar.calendarName)}`,
    `X-WR-TIMEZONE:${calendar.timezone}`,
  ];

  for (const event of timetable.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@calendar.aido.co.zw`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(
      `DTSTART;TZID=${event.timezone}:${localIcsDate(event.startsAtLocal)}`,
    );
    lines.push(
      `DTEND;TZID=${event.timezone}:${localIcsDate(event.endsAtLocal)}`,
    );
    lines.push(
      `SUMMARY:${escapeIcsText(`${event.courseCode} · ${event.title}`)}`,
    );
    lines.push(
      `DESCRIPTION:${escapeIcsText(eventDescription(event, timetable))}`,
    );
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    lines.push(`STATUS:${event.status.toUpperCase()}`);
    lines.push(`LAST-MODIFIED:${toCalendarDate(event.lastModified)}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    if (event.recurrence) {
      lines.push(
        `RRULE:FREQ=WEEKLY;INTERVAL=${event.recurrence.interval};BYDAY=${event.recurrence.weekdays.join(",")};UNTIL=${toCalendarDate(`${event.recurrence.until}T21:59:59+02:00`)}`,
      );
    }
    if (event.exclusions?.length) {
      lines.push(
        `EXDATE;TZID=${event.timezone}:${event.exclusions.map((date) => `${date.replace(/-/g, "")}T${event.startsAtLocal.slice(11).replace(/:/g, "")}`).join(",")}`,
      );
    }
    for (const minutes of calendar.reminderOffsetsMinutes) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(
        `DESCRIPTION:${escapeIcsText(alarmDescription(event, minutes))}`,
      );
      lines.push(`TRIGGER:-PT${minutes}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function generateIcs(timetable: Timetable, reminders = [1440, 30]) {
  return generateIcsFromPersonalizedCalendar(
    createPersonalizedCalendar({
      subscriptionId: "download",
      timetable,
      reminderOffsetsMinutes: reminders,
    }),
  );
}

export function downloadIcs(timetable: Timetable, reminders: number[]) {
  const blob = new Blob([generateIcs(timetable, reminders)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${timetable.slug}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildFeedUrl(publicOrigin: string, token: string) {
  return `${publicOrigin}/calendar/feed/${encodeURIComponent(token)}.ics`;
}
