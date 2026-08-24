import type { PublicTimetable } from "../src/api/pilotTypes.js";
import {
  escapeIcsText,
  foldIcsLine,
  toCalendarDate,
} from "../src/domain/calendar.js";

const weekdayMap: Record<number, string> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

function toLocalDateTime(date: Date, time: string) {
  const [hours, minutes, seconds = "00"] = time.split(":");
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}T${hours.padStart(2, "0")}${minutes.padStart(2, "0")}${seconds.padStart(2, "0")}`;
}

function localDateUntil(value: string) {
  return `${value.replace(/-/g, "")}T235959Z`;
}

function firstOccurrence(startDate: string, weekday: number) {
  const date = new Date(`${startDate}T00:00:00Z`);
  const target = weekday % 7;
  const current = date.getUTCDay();
  const delta = (target - current + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

function alarmDescription(courseName: string, minutes: number) {
  if (minutes >= 1440) return `${courseName} starts in 24 hours`;
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${courseName} starts in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${courseName} starts in ${minutes} minutes`;
}

export function generatePublishedTimetableIcs(input: {
  timetable: PublicTimetable;
  reminderOffsetsMinutes: number[];
}) {
  const timetable = input.timetable;
  const publishedAt = timetable.publishedAt ?? new Date().toISOString();
  const dtStamp = toCalendarDate(publishedAt);
  const lastModified = toCalendarDate(publishedAt);
  const reminders = [...new Set(input.reminderOffsetsMinutes)].sort(
    (a, b) => b - a,
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//aiDo//CalenderZW//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`${timetable.programme} · ${timetable.academicPeriod}`)}`,
    `X-WR-TIMEZONE:${timetable.institutionTimezone}`,
  ];

  for (const session of timetable.sessions) {
    if (!timetable.startsOn || !timetable.endsOn) {
      throw new Error("Published timetable is missing academic period dates.");
    }
    const firstDate = firstOccurrence(timetable.startsOn, session.weekday);
    lines.push("BEGIN:VEVENT");
    lines.push(
      `UID:${escapeIcsText(`${session.stableSessionKey}@calender.aido.co.zw`)}`,
    );
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(
      `DTSTART;TZID=${timetable.institutionTimezone}:${toLocalDateTime(firstDate, session.startTime)}`,
    );
    lines.push(
      `DTEND;TZID=${timetable.institutionTimezone}:${toLocalDateTime(firstDate, session.endTime)}`,
    );
    lines.push(
      `SUMMARY:${escapeIcsText(`${session.courseCode} · ${session.courseName}`)}`,
    );
    lines.push(
      `DESCRIPTION:${escapeIcsText(
        [
          `Course: ${session.courseName}`,
          `Code: ${session.courseCode}`,
          `Class group: ${timetable.classGroup}`,
          `Academic period: ${timetable.academicPeriod}`,
          session.lecturer ? `Lecturer: ${session.lecturer}` : undefined,
          session.notes ? `Notes: ${session.notes}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      )}`,
    );
    lines.push(`LOCATION:${escapeIcsText(session.venue ?? "")}`);
    lines.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${weekdayMap[session.weekday]};UNTIL=${localDateUntil(timetable.endsOn)}`,
    );
    lines.push(`LAST-MODIFIED:${lastModified}`);
    lines.push(`SEQUENCE:${timetable.versionNumber}`);
    for (const minutes of reminders) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(
        `DESCRIPTION:${escapeIcsText(alarmDescription(session.courseName, minutes))}`,
      );
      lines.push(`TRIGGER:-PT${minutes}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
