// @vitest-environment node

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  CZW_IMPORT_FORMAT_VERSION,
  parseCzwImportFormatV1,
} from "../src/domain/czwImportFormat";
import { parseStaticTimetableDocument } from "../src/domain/staticTimetableDocument";
import {
  buildCzwImportTemplateXlsx,
  extractStaticTimetableSource,
  STATIC_TIMETABLE_CSV_PARSER_VERSION,
  STATIC_TIMETABLE_XLSX_PARSER_VERSION,
} from "../server/staticTimetableInputAdapters";
import { buildStaticTimetablePersistencePayload } from "../server/staticTimetableImportRepository";

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Source").addRows([
    [
      "version",
      "title",
      "institution",
      "academic_unit",
      "academic_year",
      "semester_number",
    ],
    [
      CZW_IMPORT_FORMAT_VERSION,
      "BME Part 1",
      "HIT",
      "Biomedical Engineering",
      "2026-2027",
      1,
    ],
  ]);
  workbook.addWorksheet("Targets").addRows([
    [
      "target_key",
      "title",
      "academic_unit",
      "year_level",
      "semester_number",
      "academic_year",
    ],
    [
      "part-1-semester-1",
      "Part 1 Semester 1",
      "Biomedical Engineering",
      1,
      1,
      "2026-2027",
    ],
  ]);
  workbook.addWorksheet("Courses").addRows([
    ["target_key", "course_code", "course_name", "hours_per_week", "lecturer"],
    ["part-1-semester-1", "EBE 1103", "Engineering Chemistry", 4, ""],
  ]);
  workbook.addWorksheet("Sessions").addRows([
    [
      "target_key",
      "course_code",
      "course_name",
      "weekday",
      "start_time",
      "end_time",
      "venue",
      "lecturer",
      "delivery_mode",
    ],
    [
      "part-1-semester-1",
      "EBE 1103",
      "Engineering Chemistry",
      "Monday",
      "08:00",
      "10:00",
      "W/S",
      "",
      "",
    ],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("CZW Import Format v1", () => {
  it("validates and converts canonical JSON into existing review evidence", () => {
    const parsed = parseCzwImportFormatV1({
      version: CZW_IMPORT_FORMAT_VERSION,
      source: {
        title: "BME Part 1",
        academicUnitName: "Biomedical Engineering",
        academicYear: "2026-2027",
        semesterNumber: 1,
      },
      targets: [
        {
          targetKey: "part-1-semester-1",
          title: "Part 1 Semester 1",
          academicUnitName: "Biomedical Engineering",
          yearLevel: 1,
          semesterNumber: 1,
          academicYear: "2026-2027",
        },
      ],
      courses: [
        {
          targetKey: "part-1-semester-1",
          courseCode: "EBE1103",
          courseName: "Engineering Chemistry",
          hoursPerWeek: 4,
          lecturer: null,
          sourceText: "Engineering Chemistry / EBE1103 (W/S)",
        },
      ],
      sessions: [
        {
          targetKey: "part-1-semester-1",
          courseCode: "EBE1103",
          courseName: "Engineering Chemistry",
          weekday: 1,
          weekdayLabel: "Monday",
          startTime: "08:00",
          endTime: "10:00",
          venue: "W/S",
          lecturer: null,
          deliveryMode: null,
          sourceText: "Engineering Chemistry / EBE1103 (W/S)",
        },
      ],
      issues: [],
    });

    expect(parsed.parserVersion).toBe(CZW_IMPORT_FORMAT_VERSION);
    expect(parsed.metadata.academicYearRaw).toBe("2026-2027");
    expect(parsed.summary.sessionCount).toBe(1);
    expect(parsed.sessions[0]).toMatchObject({
      courseCode: "EBE 1103",
      courseName: "Engineering Chemistry",
      venueRaw: "W/S",
    });
  });

  it("extracts the canonical XLSX template into the same IR", async () => {
    const extraction = await extractStaticTimetableSource({
      filename: "CZW Timetable Import v1.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: await workbookBytes(),
    });

    expect(extraction.kind).toBe("czw-xlsx");
    expect(extraction.parserVersion).toBe(STATIC_TIMETABLE_XLSX_PARSER_VERSION);
    expect(extraction.parsed.metadata.academicYearRaw).toBe("2026-2027");
    expect(extraction.parsed.sessions).toHaveLength(1);
  });

  it("accepts deterministic CSV aliases and groups repeated equivalent blockers", async () => {
    const csv = [
      "target,course_code,day,start_time,end_time,venue",
      "Part 1 Semester 1,HIT300,Monday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Tuesday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Wednesday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Thursday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Friday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Saturday,08:00,10:00,Room 1",
      "Part 1 Semester 1,HIT300,Sunday,08:00,10:00,Room 1",
    ].join("\n");
    const extraction = await extractStaticTimetableSource({
      filename: "timetable.csv",
      mimeType: "text/csv",
      bytes: Buffer.from(csv),
    });
    const payload = buildStaticTimetablePersistencePayload(extraction.parsed, {
      filename: "timetable.csv",
      sha256: "abc",
    });

    expect(extraction.parserVersion).toBe(STATIC_TIMETABLE_CSV_PARSER_VERSION);
    expect(extraction.parsed.sessions).toHaveLength(7);
    expect(
      payload.warningRows.filter(
        (warning) => warning.warning_code === "COURSE_NOT_IN_REFERENCE",
      ),
    ).toHaveLength(1);
  });

  it("ships a downloadable XLSX template with the frozen version marker", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await buildCzwImportTemplateXlsx()) as unknown as ArrayBuffer,
    );
    const source = workbook.getWorksheet("Source");

    expect(source?.getCell("A2").value).toBe(CZW_IMPORT_FORMAT_VERSION);
    expect(workbook.getWorksheet("Sessions")?.getCell("A1").value).toBe(
      "target_key",
    );
  });

  it("keeps operator context separate and blocks source conflicts", () => {
    const parsed = parseCzwImportFormatV1(
      {
        version: CZW_IMPORT_FORMAT_VERSION,
        source: {
          title: "Conflict",
          academicYear: "2026-2027",
          semesterNumber: 1,
        },
        targets: [
          {
            targetKey: "part-1-semester-1",
            title: "Part 1 Semester 1",
            academicYear: "2026-2027",
            semesterNumber: 1,
          },
        ],
        courses: [],
        sessions: [
          {
            targetKey: "part-1-semester-1",
            courseCode: "HIT 1101",
            courseName: "Technopreneurship I",
            weekday: 1,
            startTime: "08:00",
            endTime: "10:00",
          },
        ],
        issues: [],
      },
      { operatorContext: { academicYear: "2025-2026", semesterNumber: 1 } },
    );

    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          fieldName: "academicYear",
        }),
      ]),
    );
  });
});

describe("DOCX parser final MVP regression", () => {
  it("extracts BME-style course names before course codes without filename hard-coding", () => {
    const parsed = parseStaticTimetableDocument({
      paragraphs: [
        "Department of Biomedical Engineering",
        "Part 1 Semester 1 Timetable 2026-2027",
      ],
      tables: [
        [
          ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY"],
          ["08:00-10:00", "Engineering Chemistry / EBE1103 (W/S)", "", ""],
        ],
        [
          ["COURSE CODE", "TITLE", "HOURS PER WEEK", "LECTURER"],
          ["EBE 1103", "Engineering Chemistry", "2 hours", ""],
        ],
      ],
    });

    expect(parsed.sessions[0]).toMatchObject({
      courseCode: "EBE 1103",
      courseName: "Engineering Chemistry",
      venueRaw: "W/S",
    });
  });
});
