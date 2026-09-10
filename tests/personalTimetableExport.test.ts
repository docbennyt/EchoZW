import { describe, expect, it } from "vitest";
import {
  buildPersonalTimetableModel,
  buildPersonalTimetablePdf,
  buildPersonalTimetableSvg,
  classifyPersonalSession,
  personalTimetableToneIndex,
} from "../src/domain/personalTimetableExport";
import type { CanonicalPublishedCalendarEvent } from "../src/domain/publishedCalendarProjection";

function event(
  overrides: Partial<CanonicalPublishedCalendarEvent>,
): CanonicalPublishedCalendarEvent {
  return {
    stableSessionKey: "session-1",
    uid: "session-1@example.test",
    weekday: 1,
    recurrenceDay: "MO",
    recurring: true,
    exceptionDate: null,
    exDates: [],
    firstDate: "2026-09-07",
    startTime: "08:00:00",
    endTime: "09:00:00",
    localStart: "20260907T080000",
    localEnd: "20260907T090000",
    firstStartUtc: "20260907T060000Z",
    firstEndUtc: "20260907T070000Z",
    recurrenceUntilUtc: "20261201T215959Z",
    courseCode: "ICS1103",
    courseName: "Fundamental of Digital Electronics",
    summary: "Fundamental of Digital Electronics",
    description: "",
    venue: "N109",
    lecturer: null,
    sessionType: "Lecture",
    notes: null,
    lastModifiedUtc: "20260901T080000Z",
    sequence: 1,
    alarms: [],
    ...overrides,
  };
}

function model() {
  return buildPersonalTimetableModel({
    institution: "Harare Institute of Technology",
    programme: "Computer Science",
    classGroup: "CS.1",
    academicPeriod: "Semester 1",
    versionNumber: 7,
    publishedAt: "2026-09-01T08:00:00Z",
    events: [
      event({ stableSessionKey: "lecture", startTime: "10:00:00" }),
      event({
        stableSessionKey: "lab",
        startTime: "08:00:00",
        endTime: "09:30:00",
        sessionType: "Laboratory",
      }),
      event({
        stableSessionKey: "lunch",
        weekday: 2,
        courseCode: "BREAK",
        courseName: "Lunch",
        sessionType: "Lunch break",
        venue: "",
      }),
    ],
  });
}

describe("personal timetable exports", () => {
  it("builds one deterministic class-specific model and sorts sessions", () => {
    const result = model();
    expect(result.sourceSessionCount).toBe(3);
    expect(
      result.days[0].sessions.map((session) => session.stableSessionKey),
    ).toEqual(["lab", "lecture"]);
    expect(result.days[0].sessions[0].kind).toBe("lab");
    expect(result.days[1].sessions[0].kind).toBe("break");
  });

  it("only labels free, break and lab states when sessionType explicitly says so", () => {
    expect(classifyPersonalSession(null)).toBe("class");
    expect(classifyPersonalSession("Lecture")).toBe("class");
    expect(classifyPersonalSession("Practical lab")).toBe("lab");
    expect(classifyPersonalSession("FREE period")).toBe("free");
    expect(classifyPersonalSession("Lunch break")).toBe("break");
  });

  it("assigns stable module tones", () => {
    expect(personalTimetableToneIndex("ICS1103")).toBe(
      personalTimetableToneIndex("ics1103"),
    );
    expect(personalTimetableToneIndex("ICS1103")).toBeGreaterThanOrEqual(0);
    expect(personalTimetableToneIndex("ICS1103")).toBeLessThan(7);
  });

  it("generates a valid PDF and SVG from the same model", () => {
    const result = model();
    const pdf = buildPersonalTimetablePdf(result);
    const pdfText = new TextDecoder().decode(pdf);
    const svg = buildPersonalTimetableSvg(result);

    expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfText).toContain("Computer Science");
    expect(pdfText).toContain("ICS1103");
    expect(pdfText).toContain("%%EOF");
    expect(svg).toContain("Computer Science");
    expect(svg).toContain("ICS1103");
    expect(svg).toContain("Lunch break");
  });
});
