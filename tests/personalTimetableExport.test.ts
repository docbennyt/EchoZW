import { describe, expect, it } from "vitest";
import {
  buildPersonalTimetableModel,
  buildPersonalTimetablePdf,
  buildPersonalTimetableScene,
  buildPersonalTimetableSvg,
  classifyPersonalSession,
  personalTimetableToneIndex,
  type PersonalTimetableScene,
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

function longNameModel() {
  const names = [
    "Software Evolution & Re-engineering",
    "Software Testing & Quality Assurance",
    "Parallel & Distributed Computing",
  ];
  return {
    names,
    model: buildPersonalTimetableModel({
      institution: "Harare Institute of Technology",
      programme: "Information Technology",
      classGroup: "IT.4",
      academicPeriod: "Semester 1 2026",
      versionNumber: 12,
      publishedAt: "2026-09-01T08:00:00Z",
      events: names.map((courseName, index) =>
        event({
          stableSessionKey: `long-${index}`,
          weekday: index === 2 ? 6 : index + 1,
          recurrenceDay: index === 2 ? "SA" : index === 1 ? "TU" : "MO",
          courseCode: `SE40${index + 1}`,
          courseName,
          summary: courseName,
          venue: `L${index + 1}`,
        }),
      ),
    }),
  };
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

  it("builds one canonical scene including empty weekdays and deterministic geometry", () => {
    const scene = buildPersonalTimetableScene(model());
    expect(scene.viewBox).toBe("0 0 1600 1130");
    expect(scene.days.map((day) => day.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    expect(scene.days[2].emptyLabel).toBe("No published sessions");
    expect(
      scene.days[0].sessions.map((session) => session.stableSessionKey),
    ).toEqual(["lab", "lecture"]);
    for (const day of scene.days) {
      expect(day.bounds.width).toBeGreaterThan(0);
      for (const session of day.sessions) {
        expect(session.bounds.width).toBe(day.bounds.width);
        expect(session.bounds.height).toBeGreaterThan(0);
      }
    }
  });

  it("keeps long module names materially readable without renderer-specific ellipses", () => {
    const fixture = longNameModel();
    const scene = buildPersonalTimetableScene(fixture.model);
    const sessions = scene.days.flatMap((day) => day.sessions);

    expect(scene.days.at(-1)?.label).toBe("Saturday");
    for (const courseName of fixture.names) {
      const session = sessions.find(
        (candidate) => candidate.courseName === courseName,
      );
      expect(session).toBeDefined();
      expect(session?.courseNameLines.join(" ")).toBe(courseName);
      expect(session?.courseNameLines.join(" ")).not.toContain("…");
    }
  });

  it("renders SVG and PDF from the exact same precomputed scene", () => {
    const scene = buildPersonalTimetableScene(model());
    const parityMarker = {
      kind: "text" as const,
      id: "parity-marker",
      x: 100,
      y: 1000,
      text: "PARITY MARKER",
      fontSize: 16,
      fontWeight: 700 as const,
      fill: "#18201d",
    };
    const markedScene: PersonalTimetableScene = {
      ...scene,
      elements: [...scene.elements, parityMarker],
    };

    const pdf = buildPersonalTimetablePdf(markedScene);
    const pdfText = new TextDecoder().decode(pdf);
    const svg = buildPersonalTimetableSvg(markedScene);

    expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfText).toContain("Computer Science");
    expect(pdfText).toContain("ICS1103");
    expect(pdfText).toContain("PARITY MARKER");
    expect(pdfText).toContain("%%EOF");
    expect(svg).toContain('data-scene-version="personal-timetable-scene-v1"');
    expect(svg).toContain("Computer Science");
    expect(svg).toContain("ICS1103");
    expect(svg).toContain("Lunch break");
    expect(svg).toContain("PARITY MARKER");
  });
});
