import { describe, expect, it } from "vitest";
import {
  assertReadyForDraft,
  buildStableSessionKey,
  createCandidatesFromCsv,
  createCandidatesFromMasterPdfText,
  createCandidatesFromStructuredDocxRows,
  detectSessionConflicts,
  getImportFeatureFlags,
  groupCandidatesByCohort,
  normalizeVenue,
  parseCohortCode,
  parseTimeRange,
  summarizeCohortCandidates,
} from "../src/domain/timetableImport";

const context = {
  periodStartsOn: "2026-02-23",
  periodEndsOn: "2026-06-05",
  knownProgrammeCodes: ["CS", "SE", "IT", "ISA"],
  knownCohortCodes: ["CS.1", "CS.2", "SE.1"],
  knownCourseCodes: ["HIT1101", "HCS1202", "HSE1101", "HIT2101"],
  programmeCourseCodes: ["HIT1101", "HCS1202", "HIT2101"],
};

describe("timetable import domain", () => {
  it("parses cohort codes and dash-separated time ranges", () => {
    expect(parseCohortCode("cs.1")).toEqual({
      programmeCode: "CS",
      cohortCode: "CS.1",
      levelLabel: "1",
    });
    expect(parseTimeRange("08:00-10:00")).toEqual({
      start: "08:00",
      end: "10:00",
    });
    expect(parseTimeRange("0800\u20131000")).toEqual({
      start: "08:00",
      end: "10:00",
    });
    expect(normalizeVenue("N101LAB")).toBe("N101-LAB");
  });

  it("creates CSV candidates with validation warnings and sanitized notes", () => {
    const csv = [
      "programme_code,cohort_code,course_code,day,start_time,end_time,venue,lecturer,notes",
      "CS,CS.1,HIT1101,Monday,08:00,10:00,N101LAB,Dr Moyo,=cmd",
      "ISE,ISE.1,HSE1101,Tuesday,11:00,10:00,,Dr Ncube,review typo",
    ].join("\n");

    const candidates = createCandidatesFromCsv(csv, context);

    expect(candidates[0]).toMatchObject({
      candidateType: "session",
      programmeCodeRaw: "CS",
      cohortCodeRaw: "CS.1",
      venueNormalized: "N101-LAB",
      notes: "'=cmd",
      reviewStatus: "warning",
    });
    expect(candidates[0].warnings.map((warning) => warning.code)).toContain(
      "UNRECOGNIZED_VENUE_FORMAT",
    );
    expect(candidates[1].reviewStatus).toBe("invalid");
    expect(candidates[1].warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "POSSIBLE_TYPO",
        "UNKNOWN_PROGRAMME_PREFIX",
        "UNKNOWN_COHORT",
        "COURSE_NOT_ASSOCIATED_WITH_PROGRAMME",
        "INVALID_TIME_RANGE",
        "MISSING_VENUE",
      ]),
    );
  });

  it("normalizes structured DOCX rows and carries the selected cohort context", () => {
    const candidates = createCandidatesFromStructuredDocxRows(
      [
        {
          day: "Monday",
          time: "08:00 - 10:00",
          course: "HIT1101 - Programming I",
          venue: "E/HALL",
          lecturer: "Dr Moyo/Dr Ncube",
          sourceRow: 4,
        },
      ],
      {
        ...context,
        selectedProgrammeCode: "CS",
        selectedCohortCode: "CS.1",
      },
    );

    expect(candidates[0]).toMatchObject({
      importMode: "cohort_docx",
      courseCodeRaw: "HIT1101",
      courseNameRaw: "Programming I",
      weekday: 1,
      lecturerNormalized: "Dr Moyo / Dr Ncube",
      reviewStatus: "valid",
      sourceRow: 4,
    });
  });

  it("treats master PDF extraction as assisted review with source warnings", () => {
    const text = [
      "Page 2",
      "Monday",
      "08:00 - 10:00",
      "CS.1 HIT1101 - E/HALL; CS.2 HCS1202/HIT2101 - N101 LAB",
      "Break",
      "Lunch",
    ].join("\n");

    const candidates = createCandidatesFromMasterPdfText(text, {
      ...context,
      sourceFilename: "SIST_Master_Timetable_Semester1_2026(First Draft).pdf",
    });

    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toMatchObject({
      importMode: "master_pdf_assisted",
      cohortCodeRaw: "CS.1",
      sourcePage: 2,
      confidence: 0.65,
    });
    expect(candidates[0].warnings.map((warning) => warning.code)).toContain(
      "SOURCE_MARKED_FIRST_DRAFT",
    );
    expect(candidates[1].warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "AMBIGUOUS_SLASHED_COURSE",
        "UNRECOGNIZED_VENUE_FORMAT",
      ]),
    );
    expect(candidates[2].warnings[0].code).toBe("BREAK_ROW_IGNORED");
    expect(candidates[3].warnings[0].code).toBe("LUNCH_ROW_IGNORED");
  });

  it("groups cohorts, summarizes review states, and detects overlaps", () => {
    const csv = [
      "programme_code,cohort_code,course_code,day,start_time,end_time,venue,lecturer",
      "CS,CS.1,HIT1101,Monday,08:00,10:00,E/HALL,Dr Moyo",
      "CS,CS.1,HCS1202,Monday,09:00,11:00,N101,Dr Ncube",
      "SE,SE.1,HSE1101,Monday,09:00,11:00,E/HALL,Dr Moyo",
    ].join("\n");
    const candidates = createCandidatesFromCsv(csv, {
      ...context,
      programmeCourseCodes: [],
    });

    expect(Object.keys(groupCandidatesByCohort(candidates))).toEqual([
      "CS.1",
      "SE.1",
    ]);
    expect(summarizeCohortCandidates(candidates)).toContainEqual({
      cohortCode: "CS.1",
      candidates: 2,
      valid: 2,
      warnings: 0,
      invalid: 0,
    });
    expect(
      Array.from(detectSessionConflicts(candidates).values())
        .flat()
        .map((warning) => warning.code),
    ).toEqual(
      expect.arrayContaining(["DUPLICATE_CANDIDATE", "LECTURER_MISMATCH"]),
    );
  });

  it("builds stable session keys and blocks invalid draft creation", () => {
    const [valid, invalid] = createCandidatesFromCsv(
      [
        "programme_code,cohort_code,course_code,day,start_time,end_time,venue,lecturer",
        "CS,CS.1,HIT1101,Monday,08:00,10:00,E/HALL,Dr Moyo",
        "CS,CS.1,HCS1202,Monday,10:00,09:00,E/HALL,Dr Moyo",
      ].join("\n"),
      context,
    );

    expect(buildStableSessionKey(valid)).toBe(
      "cs:cs.1:hit1101:1:08:00:lecture:",
    );
    expect(() => assertReadyForDraft([invalid])).toThrow(
      /No approved candidates/,
    );
    expect(() =>
      assertReadyForDraft([
        {
          ...invalid,
          reviewStatus: "warning",
        },
      ]),
    ).toThrow(/Blocking warnings/);
  });

  it("keeps CSV and DOCX enabled by default but gates risky master PDF and AI paths", () => {
    expect(getImportFeatureFlags({})).toEqual({
      csvImport: true,
      docxImport: true,
      masterPdfImport: false,
      aiExtraction: false,
    });
    expect(
      getImportFeatureFlags({
        VITE_ENABLE_CSV_IMPORT: "false",
        VITE_ENABLE_DOCX_IMPORT: "false",
        VITE_ENABLE_MASTER_PDF_IMPORT: "true",
        VITE_ENABLE_AI_EXTRACTION: "true",
      }),
    ).toEqual({
      csvImport: false,
      docxImport: false,
      masterPdfImport: true,
      aiExtraction: true,
    });
  });
});
