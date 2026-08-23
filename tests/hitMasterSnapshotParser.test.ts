import { describe, expect, it } from "vitest";
import {
  HIT_MASTER_PARSER_VERSION,
  parseHitSistMasterSnapshot,
} from "../src/domain/hitMasterSnapshotParser";
import type { GoogleDocsSourceSnapshot } from "../src/domain/sourceSnapshots";

function createReferenceTable(rows: Array<[string, string, string]>) {
  return [["CODE", "COURSE", "LECTURER"], ...rows];
}

function createFixtureSnapshot(): GoogleDocsSourceSnapshot {
  return {
    schemaVersion: 1,
    sourceId: "hit-sist-master-sem1-2026",
    provider: "google_docs_apps_script",
    fileId: "fixture-file",
    fileName: "HIT Fixture Timetable",
    observedAt: "2026-08-23T18:28:34.478Z",
    contentHash: "fixture-hash",
    tabs: [
      {
        id: "t.0",
        title: "Tab 1",
        text: "Fixture source text",
        tables: [
          createReferenceTable([
            ["ISS1101", "Introduction to Programming", "Mr Muzava"],
            ["ISS1102", "Operating Systems", "Ms Hukuimwe"],
          ]),
          [
            ["TIME", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
            [
              "08:00 - 10:00",
              "CS.1 HIT1101 – E/HALL SE.1 HIT1101 – E/HALL",
              "SE.1 ISE1101 – N111 IT.1 IIT1103/ICS1103 – N110",
              "CS.1 HIT1101 – E/HALL",
              "CS.1 ICS1101 – N110",
              "CS.1 ICS1103/IIT1103 – N112 LAB",
            ],
            ["", "B R E A K (10:00 - 10:15)", "", "", "", ""],
            [
              "10:15 - 12:15",
              "CS.1 IST1101 – MULTI-\nPURPOSE HALL",
              "CS.1 ICS1101 – N112-\nLAB",
              "CS.1 ICS1104 – E/HALL",
              "SE.1 ISE1103 – N112-LAB",
              "CS.1 ISE1101/IIT1101 – N101",
            ],
            [
              "12:15 - 13:15",
              "CS.2 ICS2101 – N101",
              "IT.2 IIT2104 – N103",
              "ISA.1 ISS1101 – S101",
              "CS.4 ICS4101 – N111 LAB",
              "SE.2 ISE2104 – N101 LAB",
            ],
            ["", "L U N C H (13:15 - 14:00)", "", "", "", ""],
            [
              "14:00 - 16:00",
              "SE.1 ISE1102/ICS1102 – N109 ISA.1 ISS1102 – N103",
              "SE.1 ISE1102/CS.1 ICS1102 – N109 IT.1 IIT1102 – S101",
              "SE.1 ISE1101 – N111 LAB",
              "CS.1 ICS1105-LAB – EE-LAB",
              "CS.1 ICS1105 – EEE",
            ],
            ["16:00 - 18:00", "", "", "", "CS.1 ICS1105-LAB – EE-LAB", ""],
          ],
          createReferenceTable([
            ["IIT1101", "Principles of Programming Languages", "Mr Butsa"],
            ["IIT1102", "Operating Systems", "Mr Gotora"],
            ["IIT1103", "Logic Design and Switching Circuits", "Ms Jonha"],
            ["IIT2104", "Data Communications", "Mr Butsa"],
            ["IST1101", "Technical Communication Skills I", "Ms Chibhabha"],
            ["HIT1101", "Technopreneurship I", "TDC"],
          ]),
          createReferenceTable([
            ["HIT101", "Technopreneurship I", "TDC"],
            ["ICS1101", "Principles of Programming Languages", "Ms Dube"],
            ["ICS1102", "Operating Systems", "Mr Mashoko"],
            [
              "ICS1103",
              "Fundamentals of Digital Electronics",
              "Mr Ndlovu /Ms Jonha",
            ],
            ["ICS1104", "Discrete Mathematics", "MATHS"],
            ["ICS1105", "Digital Electronics Lab Theory", "Mr Mpofu"],
            ["ICS2101", "Algorithms", "Mr Mashoko"],
            ["ICS4101", "Advanced Data Science", "Mr Mpofu"],
            ["IST1101", "Technical Communication Skills I", "Mr Mupini"],
          ]),
          createReferenceTable([
            ["HIT1101", "Technopreneurship I", "TDC"],
            ["ISE1101", "Principles of Programming Languages", "Mr Manjoro"],
            ["ISE1102", "Operating Systems", "Mr Mashoko"],
            [
              "ISE1103",
              "Fundamentals of Digital Electronics",
              "Mr Chibaya /Mr Nzou",
            ],
            ["ISE2104", "Software Project Management", "Mr Mukosera"],
            [
              "IST1101",
              "Technical Communication Skills I",
              "Mr Mutevani/Mr Makoni",
            ],
          ]),
        ],
      },
    ],
  };
}

describe("HIT master snapshot parser", () => {
  it("identifies the master table and reference tables structurally even when reordered", () => {
    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: createFixtureSnapshot(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    expect(result.parserVersion).toBe(HIT_MASTER_PARSER_VERSION);
    expect(result.masterTable.tableIndex).toBe(1);
    expect(
      result.referenceTables.map((table) => table.programmeCode).sort(),
    ).toEqual(["CS", "ISA", "IT", "SE"]);
  });

  it("preserves the no-silent-loss invariant across multi-marker cells", () => {
    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: createFixtureSnapshot(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    expect(result.invariants.noSilentLoss).toBe(true);
    expect(result.invariants.recognizedCohortMarkers).toBe(
      result.sessionCandidates.length,
    );
  });

  it("resolves programme-specific slash expressions only when unambiguous", () => {
    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: createFixtureSnapshot(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    const fridayCs = result.sessionCandidates.find(
      (candidate) =>
        candidate.cohortCode === "CS.1" &&
        candidate.weekday === 5 &&
        candidate.timeRaw === "08:00 - 10:00",
    );
    expect(fridayCs?.courseExpressionRaw).toBe("ICS1103/IIT1103");
    expect(fridayCs?.courseCodeResolved).toBe("ICS1103");

    const ambiguous = result.sessionCandidates.find(
      (candidate) =>
        candidate.courseExpressionRaw === "ISE1101/IIT1101" &&
        candidate.cohortCode === "CS.1",
    );
    expect(ambiguous?.courseCodeResolved).toBeNull();
    expect(ambiguous?.warnings.map((warning) => warning.code)).toContain(
      "AMBIGUOUS_SLASHED_COURSE",
    );
    expect(ambiguous?.reviewStatus).toBe("warning");
  });

  it("enriches from reference tables, preserves provenance, and surfaces shared-reference mismatches", () => {
    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: createFixtureSnapshot(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    const csHit = result.sessionCandidates.find(
      (candidate) =>
        candidate.cohortCode === "CS.1" &&
        candidate.courseExpressionRaw === "HIT1101",
    );
    expect(csHit).toMatchObject({
      courseCodeResolved: "HIT1101",
      courseName: "Technopreneurship I",
      lecturerRaw: "TDC",
      weekdayRaw: "MONDAY",
      venueRaw: "E/HALL",
    });
    expect(csHit?.warnings.map((warning) => warning.code)).toContain(
      "COURSE_REFERENCE_MISMATCH",
    );
    expect(csHit?.provenance).toMatchObject({
      columnIndex: 1,
      tableIndex: 1,
      tabId: "t.0",
      tabTitle: "Tab 1",
    });

    const csIcs = result.sessionCandidates.find(
      (candidate) =>
        candidate.cohortCode === "CS.1" &&
        candidate.courseCodeResolved === "ICS1101" &&
        candidate.weekday === 2,
    );
    expect(csIcs).toMatchObject({
      courseName: "Principles of Programming Languages",
      lecturerRaw: "Ms Dube",
      venueNormalized: "N112-LAB",
    });
  });

  it("treats break and lunch as ignored structural rows and normalizes wrapped venue text", () => {
    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: createFixtureSnapshot(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    expect(result.ignoredRecords).toHaveLength(2);
    expect(
      result.ignoredRecords.map((record) => record.warnings[0].code),
    ).toEqual(
      expect.arrayContaining(["BREAK_ROW_IGNORED", "LUNCH_ROW_IGNORED"]),
    );

    const multiPurpose = result.sessionCandidates.find(
      (candidate) => candidate.courseExpressionRaw === "IST1101",
    );
    expect(multiPurpose?.venueRaw).toBe("MULTI-PURPOSE HALL");
    expect(multiPurpose?.venueNormalized).toBe("MULTI-PURPOSE HALL");
  });

  it("is deterministic across repeated parses, including candidate IDs and summary counts", () => {
    const snapshot = createFixtureSnapshot();
    const first = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: snapshot,
      sourceKey: "hit-sist-master-sem1-2026",
    });
    const second = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: snapshot,
      sourceKey: "hit-sist-master-sem1-2026",
    });

    expect(second).toEqual(first);
  });

  it("keeps duplicate source candidates visible instead of deleting them", () => {
    const snapshot = createFixtureSnapshot();
    snapshot.tabs[0].tables[1][7][5] = "CS.1 ICS1105 – EEE CS.1 ICS1105 – EEE";

    const result = parseHitSistMasterSnapshot({
      contentHash: "fixture-content-hash",
      payload: snapshot,
      sourceKey: "hit-sist-master-sem1-2026",
    });

    const duplicates = result.sessionCandidates.filter((candidate) =>
      candidate.warnings.some(
        (warning) => warning.code === "POSSIBLE_SOURCE_DUPLICATE",
      ),
    );
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
  });
});
