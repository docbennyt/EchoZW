import type { PublicTimetable } from "../src/api/pilotTypes.js";
import { escapeIcsText } from "../src/domain/calendar.js";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection.js";
import {
  buildVTimezoneLines,
  foldIcsLineUtf8,
  formatIcsUtc,
} from "../src/domain/timezone.js";

export function generatePublishedTimetableIcs(input: {
  timetable: PublicTimetable;
  reminderOffsetsMinutes: number[];
  publicOrigin?: string;
}) {
  const calendar = projectPublishedTimetable({
    timetable: input.timetable,
    reminderOffsetsMinutes: input.reminderOffsetsMinutes,
    publicOrigin: input.publicOrigin,
  });
  const dtStamp = formatIcsUtc(new Date(calendar.publishedAt));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//aiDo//CalenderZW//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendar.calendarName)}`,
    `X-WR-TIMEZONE:${calendar.timezone}`,
    ...buildVTimezoneLines(
      calendar.timezone,
      calendar.startsOn,
      calendar.endsOn,
    ),
  ];

  for (const event of calendar.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART;TZID=${calendar.timezone}:${event.localStart}`);
    lines.push(`DTEND;TZID=${calendar.timezone}:${event.localEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    lines.push(`LOCATION:${escapeIcsText(event.venue)}`);
    if (event.recurring) {
      lines.push(
        `RRULE:FREQ=WEEKLY;BYDAY=${event.recurrenceDay};UNTIL=${event.recurrenceUntilUtc}`,
      );
      for (const dateKey of event.exDates) {
        lines.push(
          `EXDATE;TZID=${calendar.timezone}:${dateKey.replaceAll("-", "")}T${event.startTime.replaceAll(":", "")}`,
        );
      }
    }
    lines.push(`LAST-MODIFIED:${event.lastModifiedUtc}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    for (const alarm of event.alarms) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(alarm.description)}`);
      lines.push(`TRIGGER:-PT${alarm.minutesBefore}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map((line) => foldIcsLineUtf8(line)).join("\r\n")}\r\n`;
}
