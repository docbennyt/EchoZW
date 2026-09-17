import { describe, expect, it } from "vitest";
import { parseStaticTimetableDocument } from "../src/domain/staticTimetableDocument";

const structure = {
  paragraphs: [
    "Department of Biotechnology - 2026",
    "Part 1 Semester 1 Blended Timetable",
  ],
  tables: [
    [
      ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      [
        "0800-1000",
        "SBT 1102 (S103) / Online Teaching",
        "SBT 1103 Auto-Hall / Online Teaching",
        "SST 1101 S103",
        "HIT 1103 Auto-Hall",
        "HIT 1101 S103",
      ],
      [
        "1015-1215",
        "SBT 1103 S103",
        "SBT 1102 Auto-Hall",
        "HIT 1103 S103",
        "SST 1101 Auto-Hall / Online Teaching",
        "HIT 1101 S103",
      ],
      ["1215-1315", "", "", "", "", ""],
      ["", "LUNCH", "", "", "", ""],
      [
        "1400-1600",
        "ICS 1110 Lab 2",
        "SBT 1102 S103",
        "SBT 1103 Auto-Hall",
        "HIT 1101 S103",
        "",
      ],
    ],
    [
      ["COURSE CODE", "TITLE", "HOURS PER WEEK", "LECTURER"],
      ["SBT 1102", "Cell Biology", "6 hours", "Mr T. Chirova"],
      [
        "SBT 1103",
        "Chemistry for Biotechnologists",
        "6 hours",
        "Mrs Zinyando",
      ],
      [
        "SST 1101",
        "Technical Communication Skills I",
        "4 hours",
        "Service Course",
      ],
      ["SBT 1104", "Computer Applications", "4 hours", "Service Course"],
      [
        "HIT 1103",
        "Mathematics for Technologists I",
        "4 hours",
        "Service Course",
      ],
      ["HIT 1101", "Technopreneurship I", "4 hours", "Service Course"],
    ],
  ],
};

describe("static timetable DOCX matrix parser", () => {
  it("conserves the HIT Biotechnology canary invariants", () => {
    const parsed = parseStaticTimetableDocument(structure);

    expect(parsed.metadata).toMatchObject({
      departmentName: "Biotechnology",
      academicYear: 2026,
      yearLevel: 1,
      semesterNumber: 1,
      modeLabel: "Blended",
    });
    expect(parsed.summary.sessionCount).toBe(14);
    expect(parsed.summary.timetableContactHours).toBe(28);
    expect(parsed.summary.courseReferenceCount).toBe(6);
    expect(parsed.summary.courseReferenceHours).toBe(28);
    expect(parsed.ignored).toContainEqual(
      expect.objectContaining({
        kind: "break",
        rawText: "LUNCH",
        startTime: "12:15",
        endTime: "13:15",
      }),
    );
  });

  it("never silently reconciles the ICS 1110 versus SBT 1104 source discrepancy", () => {
    const parsed = parseStaticTimetableDocument(structure);
    const ics = parsed.sessions.find(
      (session) => session.courseCode === "ICS 1110",
    );

    expect(ics).toBeTruthy();
    expect(ics?.courseName).toBeNull();
    expect(ics?.warningCodes).toContain("COURSE_NOT_IN_REFERENCE");
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_NOT_IN_REFERENCE",
          severity: "error",
        }),
        expect.objectContaining({
          code: "REFERENCE_COURSE_UNUSED",
          severity: "error",
          details: expect.objectContaining({ courseCode: "SBT 1104" }),
        }),
      ]),
    );
  });

  it("preserves uncertain blended delivery wording as review evidence", () => {
    const parsed = parseStaticTimetableDocument(structure);
    const blended = parsed.sessions.filter(
      (session) => session.deliveryModeRaw,
    );

    expect(blended.length).toBeGreaterThan(0);
    expect(blended[0].deliveryModeRaw).toBe("Online Teaching");
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DELIVERY_MODE_REVIEW_REQUIRED",
          severity: "warning",
        }),
      ]),
    );
  });

  it("accepts an inline lunch row without turning it into an invalid session", () => {
    const inlineLunch = structuredClone(structure);
    inlineLunch.tables[0][3] = [
      "1215-1315 LUNCH",
      "",
      "",
      "",
      "",
      "",
    ];
    inlineLunch.tables[0].splice(4, 1);

    const parsed = parseStaticTimetableDocument(inlineLunch);

    expect(parsed.summary.sessionCount).toBe(14);
    expect(parsed.ignored).toContainEqual(
      expect.objectContaining({
        kind: "break",
        rawText: "1215-1315 LUNCH",
        startTime: "12:15",
        endTime: "13:15",
      }),
    );
    expect(parsed.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_TIME_RANGE" }),
      ]),
    );
  });

  it("normalizes spacing in course codes without changing raw evidence", () => {
    const compactCodes = structuredClone(structure);
    compactCodes.tables[0][1][1] = "SBT1102 (S103) / Online Teaching";

    const parsed = parseStaticTimetableDocument(compactCodes);
    const session = parsed.sessions.find(
      (candidate) => candidate.courseCodeRaw === "SBT1102",
    );

    expect(session).toMatchObject({
      courseCodeRaw: "SBT1102",
      courseCode: "SBT 1102",
      courseName: "Cell Biology",
    });
  });
});
