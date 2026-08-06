import { describe, expect, it } from "vitest";
import {
  generateIcs,
  escapeIcsText,
  foldIcsLine,
} from "../src/domain/calendar";
import { demoTimetable } from "../src/domain/timetableData";

describe("calendar generation", () => {
  it("generates core RFC 5545 properties", () => {
    const ics = generateIcs(demoTimetable, [1440, 30]);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:bscse21-se201-mo-0800@calender.aido.co.zw");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("personalizes reminders for two subscriptions to the same timetable", () => {
    const prepared = generateIcs(demoTimetable, [1440, 30]);
    const commuter = generateIcs(demoTimetable, [60, 15]);

    expect(prepared).toContain("TRIGGER:-PT1440M");
    expect(prepared).not.toContain("TRIGGER:-PT60M");
    expect(commuter).toContain("TRIGGER:-PT60M");
    expect(commuter).toContain("TRIGGER:-PT15M");
    expect(commuter).not.toContain("TRIGGER:-PT1440M");
  });

  it("uses CRLF line endings", () => {
    const ics = generateIcs(demoTimetable, [30]);
    expect(ics).toContain("\r\nBEGIN:VEVENT\r\n");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("escapes special characters in calendar text", () => {
    expect(escapeIcsText("Room 2, Block A; bring C:\\notes\nNow")).toBe(
      "Room 2\\, Block A\\; bring C:\\\\notes\\nNow",
    );
  });

  it("folds long calendar lines", () => {
    const folded = foldIcsLine(`DESCRIPTION:${"A".repeat(100)}`);
    expect(folded).toContain("\r\n ");
    expect(folded.split("\r\n")[0].length).toBeLessThanOrEqual(75);
  });
});
