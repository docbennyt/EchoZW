import { describe, expect, it } from "vitest";
import { buildStaticTimetableEvidence } from "../src/domain/staticTimetableEvidence";
import { parseStaticTimetableDocument } from "../src/domain/staticTimetableDocument";
import { buildStaticTimetablePersistencePayload } from "../server/staticTimetableImportRepository";

describe("static timetable persistence payload", () => {
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
