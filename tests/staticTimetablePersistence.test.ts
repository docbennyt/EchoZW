import { describe, expect, it } from "vitest";
import { buildStaticTimetableEvidence } from "../src/domain/staticTimetableEvidence";
import {
  parseStaticTimetableDocument,
  STATIC_TIMETABLE_DOCX_PARSER_VERSION,
} from "../src/domain/staticTimetableDocument";
import {
  buildStaticTimetablePersistencePayload,
  canReuseStaticTimetableImportBatch,
} from "../server/staticTimetableImportRepository";

describe("static timetable persistence payload", () => {
  it("uses a v3 parser boundary so older semantic batches do not poison reparses", () => {
    expect(STATIC_TIMETABLE_DOCX_PARSER_VERSION).toBe("static-docx-matrix-v3");

    expect(
      canReuseStaticTimetableImportBatch({
        importMode: "static_timetable_document",
        parserVersion: "static-docx-matrix-v1",
      }),
    ).toBe(false);
    expect(
      canReuseStaticTimetableImportBatch({
        importMode: "static_timetable_document",
        parserVersion: "static-docx-matrix-v2",
      }),
    ).toBe(false);
    expect(
      canReuseStaticTimetableImportBatch({
        importMode: "static_timetable_document",
        parserVersion: "static-docx-matrix-v3",
      }),
    ).toBe(true);
    expect(
      canReuseStaticTimetableImportBatch({
        importMode: "cohort_docx",
        parserVersion: "static-docx-matrix-v3",
      }),
    ).toBe(true);
  });

  it("drops meaningless blank cells but keeps meaningful ignored evidence", () => {
    const parsed = parseStaticTimetableDocument({
      paragraphs: [
        "Department of Biotechnology - 2026",
        "Part 1 Semester 1 Blended Timetable",
      ],
      tables: [
        [
          ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY"],
          ["0800-1000", "SBT 1102 (S103)", "", "SBT 1103 S103"],
          ["1000-1100 LUNCH", "", "", ""],
        ],
        [
          ["COURSE CODE", "TITLE", "HOURS PER WEEK", "LECTURER"],
          ["SBT 1102", "Cell Biology", "2 hours", "Mr T. Chirova"],
          ["SBT 1103", "Chemistry", "2 hours", "Mrs Zinyando"],
        ],
      ],
    });

    const payload = buildStaticTimetablePersistencePayload(parsed, {
      filename: "biotech.docx",
      sha256: "abc123",
    });

    expect(parsed.ignored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "blank", rawText: "" }),
        expect.objectContaining({ kind: "break", rawText: "1000-1100 LUNCH" }),
      ]),
    );
    expect(payload.candidateRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_type: "ignored_row",
          raw_text: "",
        }),
      ]),
    );
    expect(payload.candidateRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_type: "ignored_row",
          raw_text: "1000-1100 LUNCH",
        }),
      ]),
    );
  });

  it("builds proposed targets and applicability from course-reference headings", () => {
    const parsed = parseStaticTimetableDocument({
      paragraphs: [
        "Department of E-Commerce",
        "Semester I 2026-2027 Final Draft",
      ],
      tables: [
        [
          ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY"],
          ["08:00-10:00", "HIT 1101", "BEC 2108 Lab 4", "BEC 4103 Room 9"],
        ],
        [
          ["Part 1 Semester 1"],
          ["Course Code", "Course Title", "Contact Hours", "Lecturer"],
          ["HIT 1101", "Technopreneurship I", "2 hours", "Service Course"],
        ],
        [
          ["Part 2 Semester 1"],
          ["Course Code", "Course Title", "Contact Hours", "Lecturer"],
          ["BEC 2108", "E-Commerce Systems", "2 hours", "Dr Moyo"],
        ],
        [
          ["Part 4 Semester 1"],
          ["Course Code", "Course Title", "Contact Hours", "Lecturer"],
          ["BEC 4103", "Digital Strategy", "2 hours", "Ms Ncube"],
        ],
      ],
    });

    const evidence = buildStaticTimetableEvidence(parsed);
    const payload = buildStaticTimetablePersistencePayload(parsed, {
      filename: "ecommerce.docx",
      sha256: "def456",
    });

    expect(evidence.proposedTargets.map((target) => target.targetKey)).toEqual([
      "part-1-semester-1",
      "part-2-semester-1",
      "part-4-semester-1",
    ]);
    expect(payload.targetRows.map((target) => target.target_key)).toEqual([
      "part-1-semester-1",
      "part-2-semester-1",
      "part-4-semester-1",
    ]);
    expect(payload.candidateTargetRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_key: "part-1-semester-1",
          applicability_raw: "HIT 1101",
        }),
        expect.objectContaining({
          target_key: "part-2-semester-1",
          applicability_raw: "BEC 2108",
        }),
        expect.objectContaining({
          target_key: "part-4-semester-1",
          applicability_raw: "BEC 4103",
        }),
      ]),
    );
  });
});

describe("static timetable academic year evidence", () => {
  it.each([
    ["SEMESTER I TIME-TABLE 2026-2027", "2026-2027", 2026],
    ["SEMESTER I TIME-TABLE 2025/2026", "2025/2026", 2025],
    ["SEMESTER I TIME-TABLE 2026", "2026", 2026],
  ])(
    "preserves raw academic-year evidence from %s",
    (title, raw, startYear) => {
      const parsed = parseStaticTimetableDocument({
        paragraphs: ["Department of Example", title],
        tables: [
          [
            ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY"],
            ["08:00-10:00", "EXM 1101 R1", "", ""],
          ],
          [
            ["COURSE CODE", "TITLE", "HOURS PER WEEK", "LECTURER"],
            ["EXM 1101", "Example Course", "2 hours", "Dr Example"],
          ],
        ],
      });
      const evidence = buildStaticTimetableEvidence(parsed);

      expect(parsed.metadata.academicYearRaw).toBe(raw);
      expect(parsed.metadata.academicYear).toBe(startYear);
      expect(evidence.proposedTargets[0]?.academicYearRaw).toBe(raw);
    },
  );
});
