import { createHash } from "node:crypto";
import type { GoogleDocsSourceSnapshot } from "./sourceSnapshots.js";
import {
  type CandidateWarningCode,
  normalizeLecturer,
  normalizeVenue,
  parseCohortCode,
  parseTimeRange,
  parseWeekday,
  type ImportWarning,
} from "./timetableImport.js";

export const HIT_MASTER_PARSER_VERSION = "hit-sist-google-docs-v1";

type HitProgrammeCode = "CS" | "SE" | "IT" | "ISA";
type SharedCoursePrefix = "HIT" | "IST" | "TEC";
type ParserWarningCode =
  | CandidateWarningCode
  | "MASTER_TABLE_NOT_FOUND"
  | "AMBIGUOUS_MASTER_TABLE"
  | "REFERENCE_TABLE_NOT_FOUND"
  | "AMBIGUOUS_REFERENCE_TABLE"
  | "MISSING_COURSE_EXPRESSION";

export type HitParserWarning = Omit<ImportWarning, "code"> & {
  code: ParserWarningCode;
};

export type HitParserFailureCode =
  | "MASTER_TABLE_NOT_FOUND"
  | "AMBIGUOUS_MASTER_TABLE"
  | "REFERENCE_TABLE_NOT_FOUND"
  | "AMBIGUOUS_REFERENCE_TABLE"
  | "NO_SILENT_LOSS_INVARIANT_FAILED";

export class HitParserError extends Error {
  constructor(
    public readonly code: HitParserFailureCode,
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type HitSnapshotParserInput = {
  contentHash: string;
  payload: GoogleDocsSourceSnapshot;
  sourceKey: string;
};

export type HitSourceProvenance = {
  columnIndex: number;
  rawCourse: string;
  rawText: string;
  rawTime: string;
  rawVenue: string | null;
  rawWeekday: string;
  rowIndex: number;
  sourceCell: string;
  tableIndex: number;
  tabId: string;
  tabTitle: string;
};

export type HitCourseCatalogEntry = {
  courseCode: string;
  courseName: string;
  courseNameNormalized: string;
  id: string;
  lecturerNormalized: string | null;
  lecturerRaw: string;
  programmeCode: HitProgrammeCode;
  provenance: HitSourceProvenance;
  rawCode: string;
  rawText: string;
  warnings: HitParserWarning[];
};

export type HitParsedSessionCandidate = {
  confidence: number;
  cohortCode: string;
  courseCodeResolved: string | null;
  courseExpressionRaw: string;
  courseName: string | null;
  id: string;
  lecturerNormalized: string | null;
  lecturerRaw: string | null;
  programmeCode: HitProgrammeCode;
  provenance: HitSourceProvenance;
  reviewStatus: "invalid" | "valid" | "warning";
  sourceCandidateKey: string;
  startTime: string | null;
  timeRaw: string;
  warnings: HitParserWarning[];
  venueNormalized: string | null;
  venueRaw: string | null;
  weekday: number | null;
  weekdayRaw: string;
  endTime: string | null;
};

export type HitIgnoredRecord = {
  id: string;
  provenance: HitSourceProvenance;
  rawText: string;
  reviewStatus: "ignored";
  warnings: HitParserWarning[];
};

export type HitParserSummary = {
  cohortCounts: Record<string, number>;
  ignoredCount: number;
  invalidCount: number;
  programmeCounts: Record<HitProgrammeCode, number>;
  validCount: number;
  warningCount: number;
};

export type HitMasterTableDescriptor = {
  columnCount: number;
  rowCount: number;
  tableIndex: number;
  tabId: string;
  tabTitle: string;
  weekdayHeaders: string[];
};

export type HitReferenceTableDescriptor = {
  courseCount: number;
  programmeCode: HitProgrammeCode;
  tableIndex: number;
  tabId: string;
  tabTitle: string;
};

export type HitParserResult = {
  courseCatalog: HitCourseCatalogEntry[];
  ignoredRecords: HitIgnoredRecord[];
  invariants: {
    candidateLikeRecordCount: number;
    noSilentLoss: boolean;
    recognizedCohortMarkers: number;
  };
  masterTable: HitMasterTableDescriptor;
  parserVersion: typeof HIT_MASTER_PARSER_VERSION;
  referenceTables: HitReferenceTableDescriptor[];
  sessionCandidates: HitParsedSessionCandidate[];
  sourceMetadata: {
    contentHash: string;
    externalFileId: string;
    fileName: string;
    observedAt: string;
    sourceKey: string;
    tabCount: number;
    tableCount: number;
  };
  status: "parsed" | "review_required";
  summary: HitParserSummary;
  warnings: HitParserWarning[];
};

const COHORT_MARKER_REGEX = /\b(CS|SE|IT|ISA)\.\d+\b/g;
const MASTER_WEEKDAY_HEADERS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;
const PROGRAMME_PREFIXES: Record<HitProgrammeCode, string> = {
  CS: "ICS",
  ISA: "ISS",
  IT: "IIT",
  SE: "ISE",
};
const PROGRAMME_CODES = Object.keys(PROGRAMME_PREFIXES) as HitProgrammeCode[];
const SHARED_PREFIXES = new Set<SharedCoursePrefix>(["HIT", "IST", "TEC"]);

type TableCell = string;
type TableRow = TableCell[];
type SourceTable = TableRow[];

type ReferenceTableDetection = {
  descriptors: HitReferenceTableDescriptor[];
  entries: HitCourseCatalogEntry[];
};

type CandidateLookupEntry = {
  courseCode: string;
  entries: HitCourseCatalogEntry[];
  lecturerValues: string[];
  programmeEntries: Map<HitProgrammeCode, HitCourseCatalogEntry>;
};

function createDeterministicId(prefix: string, seed: string) {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/([A-Za-z0-9])-\s*\n\s*([A-Za-z0-9])/g, "$1-$2")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCellText(value: string | undefined) {
  return normalizeWhitespace(String(value ?? ""));
}

function normalizeStructuralLabel(value: string) {
  return normalizeWhitespace(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeCourseToken(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizeCourseNameForComparison(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function candidateReviewStatus(
  warnings: HitParserWarning[],
): HitParsedSessionCandidate["reviewStatus"] {
  if (warnings.some((warning) => warning.severity === "blocking")) {
    return "invalid";
  }
  if (warnings.some((warning) => warning.severity === "warning")) {
    return "warning";
  }
  return "valid";
}

function parseMasterTable(payload: GoogleDocsSourceSnapshot): {
  table: SourceTable;
  descriptor: HitMasterTableDescriptor;
} {
  const candidates: Array<{
    descriptor: HitMasterTableDescriptor;
    table: SourceTable;
  }> = [];

  for (const tab of payload.tabs) {
    tab.tables.forEach((table: SourceTable, tableIndex: number) => {
      const header =
        table[0]?.map((cell: TableCell) => normalizeCellText(cell)) ?? [];
      if (header.length < 6) return;
      if (header[0] !== "TIME") return;
      const weekdays = header.slice(1, 6);
      if (
        weekdays.length !== MASTER_WEEKDAY_HEADERS.length ||
        weekdays.some(
          (value: string, index: number) =>
            value !== MASTER_WEEKDAY_HEADERS[index],
        )
      ) {
        return;
      }

      candidates.push({
        descriptor: {
          columnCount: table[0].length,
          rowCount: table.length,
          tableIndex,
          tabId: tab.id,
          tabTitle: tab.title,
          weekdayHeaders: weekdays,
        },
        table,
      });
    });
  }

  if (candidates.length === 0) {
    throw new HitParserError(
      "MASTER_TABLE_NOT_FOUND",
      "No structural TIME x weekday master timetable was found.",
    );
  }
  if (candidates.length > 1) {
    throw new HitParserError(
      "AMBIGUOUS_MASTER_TABLE",
      "More than one structural TIME x weekday master timetable was found.",
      {
        candidates: candidates.map((candidate) => candidate.descriptor),
      },
    );
  }

  return candidates[0];
}

function detectReferenceTables(
  payload: GoogleDocsSourceSnapshot,
): ReferenceTableDetection {
  const tablesByProgramme = new Map<
    HitProgrammeCode,
    HitReferenceTableDescriptor
  >();
  const entries: HitCourseCatalogEntry[] = [];

  for (const tab of payload.tabs) {
    tab.tables.forEach((table: SourceTable, tableIndex: number) => {
      const header =
        table[0]?.map((cell: TableCell) => normalizeCellText(cell)) ?? [];
      if (
        header.length < 3 ||
        header[0] !== "CODE" ||
        header[1] !== "COURSE" ||
        header[2] !== "LECTURER"
      ) {
        return;
      }

      const programmeCode = detectReferenceTableProgramme(table);
      if (!programmeCode) {
        return;
      }

      if (tablesByProgramme.has(programmeCode)) {
        throw new HitParserError(
          "AMBIGUOUS_REFERENCE_TABLE",
          `More than one course reference table matched ${programmeCode}.`,
          {
            programmeCode,
            existing: tablesByProgramme.get(programmeCode),
            next: {
              courseCount: table.length - 1,
              programmeCode,
              tableIndex,
              tabId: tab.id,
              tabTitle: tab.title,
            },
          },
        );
      }

      const descriptor: HitReferenceTableDescriptor = {
        courseCount: Math.max(table.length - 1, 0),
        programmeCode,
        tableIndex,
        tabId: tab.id,
        tabTitle: tab.title,
      };
      tablesByProgramme.set(programmeCode, descriptor);

      table.slice(1).forEach((row: TableRow, rowIndex: number) => {
        const rawCode = normalizeCellText(row[0]);
        const rawCourseName = normalizeCellText(row[1]);
        const rawLecturer = normalizeCellText(row[2]);
        if (!rawCode || !rawCourseName) return;

        const rawText = [rawCode, rawCourseName, rawLecturer]
          .filter(Boolean)
          .join(" | ");
        const provenance = buildProvenance({
          columnIndex: 0,
          rawCourse: rawCode,
          rawText,
          rawTime: "",
          rawVenue: null,
          rawWeekday: "",
          rowIndex: rowIndex + 1,
          sourceCell: rawText,
          tableIndex,
          tabId: tab.id,
          tabTitle: tab.title,
        });
        entries.push({
          courseCode: normalizeCourseToken(rawCode),
          courseName: rawCourseName,
          courseNameNormalized: normalizeCourseNameForComparison(rawCourseName),
          id: createDeterministicId(
            "catalog",
            `${HIT_MASTER_PARSER_VERSION}:${payload.fileId}:${tab.id}:${tableIndex}:${rowIndex}:${rawText}`,
          ),
          lecturerNormalized: normalizeLecturer(rawLecturer) ?? null,
          lecturerRaw: rawLecturer,
          programmeCode,
          provenance,
          rawCode,
          rawText,
          warnings: [],
        });
      });
    });
  }

  const missingProgrammes = PROGRAMME_CODES.filter(
    (programmeCode) => !tablesByProgramme.has(programmeCode),
  );
  if (missingProgrammes.length > 0) {
    throw new HitParserError(
      "REFERENCE_TABLE_NOT_FOUND",
      "Not every required programme course-reference table was found.",
      {
        missingProgrammes,
      },
    );
  }

  return {
    descriptors: [...tablesByProgramme.values()],
    entries: addReferenceWarnings(entries),
  };
}

function detectReferenceTableProgramme(table: SourceTable) {
  const counts = new Map<HitProgrammeCode, number>();
  table.slice(1).forEach((row: TableRow) => {
    const code = normalizeCourseToken(normalizeCellText(row[0]));
    if (code.startsWith("ICS")) {
      counts.set("CS", (counts.get("CS") ?? 0) + 1);
    } else if (code.startsWith("ISE")) {
      counts.set("SE", (counts.get("SE") ?? 0) + 1);
    } else if (code.startsWith("IIT")) {
      counts.set("IT", (counts.get("IT") ?? 0) + 1);
    } else if (code.startsWith("ISS")) {
      counts.set("ISA", (counts.get("ISA") ?? 0) + 1);
    }
  });

  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

function addReferenceWarnings(entries: HitCourseCatalogEntry[]) {
  const entriesByProgramme = new Map<
    HitProgrammeCode,
    HitCourseCatalogEntry[]
  >();
  const entriesByCode = new Map<string, HitCourseCatalogEntry[]>();

  entries.forEach((entry) => {
    entriesByProgramme.set(entry.programmeCode, [
      ...(entriesByProgramme.get(entry.programmeCode) ?? []),
      entry,
    ]);
    entriesByCode.set(entry.courseCode, [
      ...(entriesByCode.get(entry.courseCode) ?? []),
      entry,
    ]);
  });

  return entries.map((entry) => {
    const warnings = [...entry.warnings];
    if (entry.rawCode !== entry.courseCode) {
      warnings.push({
        code: "POSSIBLE_TYPO",
        fieldName: "course_code",
        message:
          "Course code required whitespace normalization before parser use.",
        severity: "warning",
        suggestedValue: entry.courseCode,
      });
    }

    if (!entry.courseCode.startsWith(PROGRAMME_PREFIXES[entry.programmeCode])) {
      const codeMatches = entriesByCode.get(entry.courseCode) ?? [];
      const sameCodeAcrossTables = codeMatches.length >= 2;
      if (
        !sameCodeAcrossTables &&
        SHARED_PREFIXES.has(prefixForCode(entry.courseCode))
      ) {
        warnings.push({
          code: "COURSE_REFERENCE_MISMATCH",
          fieldName: "course_code",
          message:
            "Shared course code appears in this programme table without matching cross-programme confirmation.",
          severity: "warning",
        });
      }
    }

    return {
      ...entry,
      warnings,
    };
  });
}

function prefixForCode(value: string) {
  return value.slice(0, 3) as SharedCoursePrefix;
}

function buildProvenance(input: HitSourceProvenance) {
  return input;
}

function buildReferenceLookup(entries: HitCourseCatalogEntry[]) {
  const lookup = new Map<string, CandidateLookupEntry>();
  entries.forEach((entry) => {
    const existing = lookup.get(entry.courseCode);
    if (!existing) {
      lookup.set(entry.courseCode, {
        courseCode: entry.courseCode,
        entries: [entry],
        lecturerValues: entry.lecturerNormalized
          ? [entry.lecturerNormalized]
          : [],
        programmeEntries: new Map([[entry.programmeCode, entry]]),
      });
      return;
    }
    existing.entries.push(entry);
    if (entry.lecturerNormalized) {
      existing.lecturerValues.push(entry.lecturerNormalized);
    }
    existing.programmeEntries.set(entry.programmeCode, entry);
  });
  return lookup;
}

function lastVenueSeparator(value: string) {
  const matches = [...value.matchAll(/\s[\u2013\u2014-]\s/g)];
  return matches.at(-1)?.index ?? -1;
}

function containsCohortMarker(value: string) {
  return /\b(?:CS|SE|IT|ISA)\.\d+\b/.test(value);
}

function splitCellIntoLogicalLines(value: string | undefined) {
  const prepared = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/([A-Za-z0-9])-\s*\n\s*([A-Za-z0-9])/g, "$1-$2");
  const rawLines = prepared
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const merged: string[] = [];
  rawLines.forEach((line) => {
    if (containsCohortMarker(line) || merged.length === 0) {
      merged.push(line);
      return;
    }
    merged[merged.length - 1] = normalizeWhitespace(
      `${merged[merged.length - 1]} ${line}`,
    );
  });
  return merged;
}

function parseSessionCandidates(input: {
  contentHash: string;
  lookup: Map<string, CandidateLookupEntry>;
  masterTable: SourceTable;
  masterTableDescriptor: HitMasterTableDescriptor;
  payload: GoogleDocsSourceSnapshot;
}) {
  const sessionCandidates: HitParsedSessionCandidate[] = [];
  const ignoredRecords: HitIgnoredRecord[] = [];
  let recognizedCohortMarkers = 0;
  const tab = input.payload.tabs.find(
    (candidate) => candidate.id === input.masterTableDescriptor.tabId,
  )!;

  input.masterTable.slice(1).forEach((row, rowIndex) => {
    const timeRaw = normalizeCellText(row[0]);
    const timeRange = parseTimeRange(timeRaw);
    const structuralRowText = row
      .map((cell: TableCell) => normalizeCellText(cell))
      .join(" ");
    const structuralLabel = normalizeStructuralLabel(structuralRowText);

    if (!timeRange) {
      if (structuralLabel.includes("BREAK")) {
        ignoredRecords.push(
          createIgnoredRecord({
            code: "BREAK_ROW_IGNORED",
            rowIndex: rowIndex + 1,
            rowText: structuralRowText,
            tab,
            tableIndex: input.masterTableDescriptor.tableIndex,
          }),
        );
      } else if (structuralLabel.includes("LUNCH")) {
        ignoredRecords.push(
          createIgnoredRecord({
            code: "LUNCH_ROW_IGNORED",
            rowIndex: rowIndex + 1,
            rowText: structuralRowText,
            tab,
            tableIndex: input.masterTableDescriptor.tableIndex,
          }),
        );
      }
      return;
    }

    MASTER_WEEKDAY_HEADERS.forEach((weekdayHeader, weekdayOffset) => {
      const columnIndex = weekdayOffset + 1;
      const sourceCell = normalizeCellText(row[columnIndex]);
      if (!sourceCell) return;

      const logicalLines = splitCellIntoLogicalLines(row[columnIndex]);
      logicalLines.forEach((logicalLine, logicalLineIndex) => {
        const markerMatches = [...logicalLine.matchAll(COHORT_MARKER_REGEX)];
        if (markerMatches.length === 0) {
          return;
        }
        recognizedCohortMarkers += markerMatches.length;

        const separatorIndex = lastVenueSeparator(logicalLine);
        const sharedVenue =
          separatorIndex >= 0
            ? normalizeCellText(logicalLine.slice(separatorIndex + 3))
            : "";
        const leftSide =
          separatorIndex >= 0
            ? normalizeCellText(logicalLine.slice(0, separatorIndex))
            : logicalLine;

        markerMatches.forEach((marker, markerIndex) => {
          const nextStart =
            markerMatches[markerIndex + 1]?.index ?? leftSide.length;
          const segmentText = normalizeCellText(
            leftSide.slice(marker.index ?? 0, nextStart),
          );
          sessionCandidates.push(
            parseSegmentCandidate({
              contentHash: input.contentHash,
              lookup: input.lookup,
              markerIndex: logicalLineIndex * 100 + markerIndex,
              segmentText,
              sharedVenue: sharedVenue || null,
              tab,
              tableIndex: input.masterTableDescriptor.tableIndex,
              timeRange,
              timeRaw,
              weekdayHeader,
              columnIndex,
              rowIndex: rowIndex + 1,
              sourceCell,
            }),
          );
        });
      });
    });
  });

  const candidatesWithDuplicates = addDuplicateWarnings(sessionCandidates);
  if (candidatesWithDuplicates.length !== recognizedCohortMarkers) {
    throw new HitParserError(
      "NO_SILENT_LOSS_INVARIANT_FAILED",
      "Recognized cohort markers did not map one-to-one to candidate-like records.",
      {
        candidateLikeRecordCount: candidatesWithDuplicates.length,
        recognizedCohortMarkers,
      },
    );
  }

  return {
    ignoredRecords,
    recognizedCohortMarkers,
    sessionCandidates: candidatesWithDuplicates,
  };
}

function createIgnoredRecord(input: {
  code: "BREAK_ROW_IGNORED" | "LUNCH_ROW_IGNORED";
  rowIndex: number;
  rowText: string;
  tab: GoogleDocsSourceSnapshot["tabs"][number];
  tableIndex: number;
}) {
  const provenance = buildProvenance({
    columnIndex: 0,
    rawCourse: "",
    rawText: input.rowText,
    rawTime: "",
    rawVenue: null,
    rawWeekday: "",
    rowIndex: input.rowIndex,
    sourceCell: input.rowText,
    tableIndex: input.tableIndex,
    tabId: input.tab.id,
    tabTitle: input.tab.title,
  });

  return {
    id: createDeterministicId(
      "ignored",
      `${HIT_MASTER_PARSER_VERSION}:${input.tab.id}:${input.tableIndex}:${input.rowIndex}:${input.code}:${input.rowText}`,
    ),
    provenance,
    rawText: input.rowText,
    reviewStatus: "ignored" as const,
    warnings: [
      {
        code: input.code,
        message:
          input.code === "BREAK_ROW_IGNORED"
            ? "Break row ignored."
            : "Lunch row ignored.",
        severity: "info" as const,
      },
    ],
  };
}

function parseSegmentCandidate(input: {
  columnIndex: number;
  contentHash: string;
  lookup: Map<string, CandidateLookupEntry>;
  markerIndex: number;
  rowIndex: number;
  segmentText: string;
  sharedVenue: string | null;
  sourceCell: string;
  tab: GoogleDocsSourceSnapshot["tabs"][number];
  tableIndex: number;
  timeRange: { end: string; start: string };
  timeRaw: string;
  weekdayHeader: string;
}) {
  const cohort = parseCohortCode(input.segmentText.split(" ")[0] ?? "");
  const warnings: HitParserWarning[] = [];
  const programmeCode =
    (cohort?.programmeCode as HitProgrammeCode | undefined) ?? null;
  const cohortCode =
    cohort?.cohortCode ?? input.segmentText.split(" ")[0] ?? "";
  const afterCohort = normalizeCellText(
    input.segmentText.slice(cohortCode.length),
  );
  const courseExpressionMatch = afterCohort.match(
    /^([A-Z]{2,4}\s?\d{3,4}(?:\s*\/\s*[A-Z]{2,4}\s?\d{3,4})*)\b/i,
  );
  const courseExpressionRaw = courseExpressionMatch
    ? normalizeCellText(courseExpressionMatch[1])
    : "";
  if (!courseExpressionRaw) {
    warnings.push({
      code: "MISSING_COURSE_EXPRESSION",
      fieldName: "course",
      message:
        "No deterministic course expression could be parsed for the cohort marker.",
      severity: "blocking",
    });
  }

  const trailingText = courseExpressionMatch
    ? normalizeCellText(afterCohort.slice(courseExpressionMatch[0].length))
    : afterCohort;
  const localVenue =
    input.sharedVenue ??
    (lastVenueSeparator(trailingText) >= 0
      ? normalizeCellText(
          trailingText.slice(lastVenueSeparator(trailingText) + 3),
        )
      : normalizeCellText(trailingText.replace(/^[\u2013\u2014-]\s*/, ""))) ??
    null;
  const weekday = parseWeekday(input.weekdayHeader) ?? null;
  if (!weekday) {
    warnings.push({
      code: "POSSIBLE_TYPO",
      fieldName: "weekday",
      message: "Weekday header could not be normalized.",
      severity: "blocking",
    });
  }

  let courseCodeResolved: string | null = null;
  if (programmeCode && courseExpressionRaw) {
    const resolution = resolveCourseExpression({
      courseExpressionRaw,
      programmeCode,
    });
    courseCodeResolved = resolution.courseCodeResolved;
    warnings.push(...resolution.warnings);
  }

  const enrichment = programmeCode
    ? enrichCourseReference({
        courseCodeResolved,
        courseExpressionRaw,
        lookup: input.lookup,
        programmeCode,
      })
    : {
        courseName: null,
        lecturerNormalized: null,
        lecturerRaw: null,
        warnings: [] as HitParserWarning[],
      };
  warnings.push(...enrichment.warnings);

  const venueNormalized = normalizeVenue(localVenue ?? undefined) ?? null;
  if (!localVenue) {
    warnings.push({
      code: "MISSING_VENUE",
      fieldName: "venue",
      message: "Venue is missing from the parsed source segment.",
      severity: "warning",
    });
  }

  const rawText = [input.segmentText, localVenue ? `– ${localVenue}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  const provenance = buildProvenance({
    columnIndex: input.columnIndex,
    rawCourse: courseExpressionRaw,
    rawText,
    rawTime: input.timeRaw,
    rawVenue: localVenue,
    rawWeekday: input.weekdayHeader,
    rowIndex: input.rowIndex,
    sourceCell: input.sourceCell,
    tableIndex: input.tableIndex,
    tabId: input.tab.id,
    tabTitle: input.tab.title,
  });

  const reviewStatus = candidateReviewStatus(warnings);
  return {
    confidence:
      reviewStatus === "valid" ? 0.98 : reviewStatus === "warning" ? 0.7 : 0.45,
    cohortCode,
    courseCodeResolved,
    courseExpressionRaw,
    courseName: enrichment.courseName,
    endTime: input.timeRange.end,
    id: createDeterministicId(
      "sess",
      `${HIT_MASTER_PARSER_VERSION}:${input.contentHash}:${input.tableIndex}:${input.rowIndex}:${input.columnIndex}:${input.markerIndex}:${cohortCode}:${courseExpressionRaw}:${input.timeRange.start}:${input.timeRange.end}:${localVenue ?? ""}`,
    ),
    lecturerNormalized: enrichment.lecturerNormalized,
    lecturerRaw: enrichment.lecturerRaw,
    programmeCode: programmeCode ?? "CS",
    provenance,
    reviewStatus,
    sourceCandidateKey: [
      input.tableIndex,
      input.rowIndex,
      input.columnIndex,
      cohortCode,
      courseExpressionRaw,
      input.timeRange.start,
      input.timeRange.end,
    ].join(":"),
    startTime: input.timeRange.start,
    timeRaw: input.timeRaw,
    warnings,
    venueNormalized,
    venueRaw: localVenue,
    weekday,
    weekdayRaw: input.weekdayHeader,
  } satisfies HitParsedSessionCandidate;
}

function resolveCourseExpression(input: {
  courseExpressionRaw: string;
  programmeCode: HitProgrammeCode;
}) {
  const warnings: HitParserWarning[] = [];
  const tokens = input.courseExpressionRaw
    .split("/")
    .map((token) => normalizeCourseToken(token))
    .filter(Boolean);
  if (tokens.length === 0) {
    warnings.push({
      code: "MISSING_COURSE_EXPRESSION",
      fieldName: "course",
      message:
        "No course code tokens could be resolved from the source segment.",
      severity: "blocking",
    });
    return { courseCodeResolved: null, warnings };
  }
  if (tokens.length === 1) {
    return { courseCodeResolved: tokens[0], warnings };
  }

  const preferredPrefix = PROGRAMME_PREFIXES[input.programmeCode];
  const preferred = tokens.filter((token) => token.startsWith(preferredPrefix));
  if (preferred.length === 1) {
    return { courseCodeResolved: preferred[0], warnings };
  }

  warnings.push({
    code: "AMBIGUOUS_SLASHED_COURSE",
    fieldName: "course",
    message:
      "Slash-separated course expression could not be resolved unambiguously for the cohort programme.",
    severity: "warning",
  });
  return {
    courseCodeResolved: null,
    warnings,
  };
}

function enrichCourseReference(input: {
  courseCodeResolved: string | null;
  courseExpressionRaw: string;
  lookup: Map<string, CandidateLookupEntry>;
  programmeCode: HitProgrammeCode;
}) {
  const warnings: HitParserWarning[] = [];
  if (!input.courseCodeResolved) {
    return {
      courseName: null,
      lecturerNormalized: null,
      lecturerRaw: null,
      warnings,
    };
  }

  const exact = input.lookup.get(input.courseCodeResolved);
  if (!exact) {
    warnings.push({
      code: "UNKNOWN_COURSE",
      fieldName: "course_code",
      message: `No source reference row matched ${input.courseCodeResolved}.`,
      severity: "warning",
    });
    return {
      courseName: null,
      lecturerNormalized: null,
      lecturerRaw: null,
      warnings,
    };
  }

  const programmeEntry = exact.programmeEntries.get(input.programmeCode);
  if (programmeEntry) {
    return {
      courseName: programmeEntry.courseName,
      lecturerNormalized: programmeEntry.lecturerNormalized,
      lecturerRaw: programmeEntry.lecturerRaw || null,
      warnings: [...programmeEntry.warnings],
    };
  }

  const distinctCourseNames = new Set(
    exact.entries.map(
      (entry: HitCourseCatalogEntry) => entry.courseNameNormalized,
    ),
  );
  if (distinctCourseNames.size > 1) {
    warnings.push({
      code: "COURSE_REFERENCE_MISMATCH",
      fieldName: "course_code",
      message:
        "Exact course code exists across reference tables but with conflicting course names.",
      severity: "warning",
    });
    return {
      courseName: null,
      lecturerNormalized: null,
      lecturerRaw: null,
      warnings,
    };
  }

  const distinctLecturers = new Set(
    exact.entries
      .map((entry: HitCourseCatalogEntry) => entry.lecturerNormalized)
      .filter((value): value is string => Boolean(value)),
  );
  warnings.push({
    code: "COURSE_REFERENCE_MISMATCH",
    fieldName: "course_code",
    message:
      "Programme-specific reference row was missing, so enrichment fell back to shared reference entries.",
    severity: "warning",
  });
  if (distinctLecturers.size > 1) {
    warnings.push({
      code: "LECTURER_MISMATCH",
      fieldName: "lecturer",
      message:
        "Shared reference rows disagreed on lecturer, so lecturer enrichment remains unresolved.",
      severity: "warning",
    });
  }

  return {
    courseName: exact.entries[0].courseName,
    lecturerNormalized:
      distinctLecturers.size === 1 ? [...distinctLecturers][0] : null,
    lecturerRaw:
      distinctLecturers.size === 1
        ? (exact.entries.find(
            (entry: HitCourseCatalogEntry) =>
              entry.lecturerNormalized === [...distinctLecturers][0],
          )?.lecturerRaw ?? null)
        : null,
    warnings,
  };
}

function addDuplicateWarnings(candidates: HitParsedSessionCandidate[]) {
  const counts = new Map<string, number>();
  candidates.forEach((candidate) => {
    const key = [
      candidate.cohortCode,
      candidate.courseCodeResolved ?? candidate.courseExpressionRaw,
      candidate.weekday ?? 0,
      candidate.startTime ?? "",
      candidate.endTime ?? "",
      candidate.venueNormalized ?? candidate.venueRaw ?? "",
    ].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return candidates.map((candidate) => {
    const key = [
      candidate.cohortCode,
      candidate.courseCodeResolved ?? candidate.courseExpressionRaw,
      candidate.weekday ?? 0,
      candidate.startTime ?? "",
      candidate.endTime ?? "",
      candidate.venueNormalized ?? candidate.venueRaw ?? "",
    ].join("|");
    if ((counts.get(key) ?? 0) < 2) {
      return candidate;
    }

    const warnings = [
      ...candidate.warnings,
      {
        code: "POSSIBLE_SOURCE_DUPLICATE" as const,
        fieldName: "source",
        message:
          "Another source candidate resolved to the same cohort/course/time/venue combination.",
        severity: "warning" as const,
      },
    ];
    return {
      ...candidate,
      reviewStatus: candidateReviewStatus(warnings),
      warnings,
    };
  });
}

function summariseResult(input: {
  courseCatalog: HitCourseCatalogEntry[];
  ignoredRecords: HitIgnoredRecord[];
  sessionCandidates: HitParsedSessionCandidate[];
}) {
  const cohortCounts: Record<string, number> = {};
  const programmeCounts = {
    CS: 0,
    ISA: 0,
    IT: 0,
    SE: 0,
  } satisfies Record<HitProgrammeCode, number>;

  input.sessionCandidates.forEach((candidate) => {
    cohortCounts[candidate.cohortCode] =
      (cohortCounts[candidate.cohortCode] ?? 0) + 1;
    programmeCounts[candidate.programmeCode] += 1;
  });

  const validCount = input.sessionCandidates.filter(
    (candidate) => candidate.reviewStatus === "valid",
  ).length;
  const warningCount = input.sessionCandidates.filter(
    (candidate) => candidate.reviewStatus === "warning",
  ).length;
  const invalidCount = input.sessionCandidates.filter(
    (candidate) => candidate.reviewStatus === "invalid",
  ).length;

  return {
    cohortCounts,
    ignoredCount: input.ignoredRecords.length,
    invalidCount,
    programmeCounts,
    validCount,
    warningCount,
  } satisfies HitParserSummary;
}

export function parseHitSistMasterSnapshot(
  input: HitSnapshotParserInput,
): HitParserResult {
  const { descriptor: masterTableDescriptor, table: masterTable } =
    parseMasterTable(input.payload);
  const { descriptors: referenceTables, entries: courseCatalog } =
    detectReferenceTables(input.payload);
  const lookup = buildReferenceLookup(courseCatalog);
  const { ignoredRecords, recognizedCohortMarkers, sessionCandidates } =
    parseSessionCandidates({
      contentHash: input.contentHash,
      lookup,
      masterTable,
      masterTableDescriptor,
      payload: input.payload,
    });

  const warnings = [
    ...courseCatalog.flatMap((entry) => entry.warnings),
    ...sessionCandidates.flatMap((candidate) => candidate.warnings),
    ...ignoredRecords.flatMap((record) => record.warnings),
  ];
  const summary = summariseResult({
    courseCatalog,
    ignoredRecords,
    sessionCandidates,
  });
  const status =
    summary.warningCount > 0 || summary.invalidCount > 0
      ? "review_required"
      : "parsed";

  return {
    courseCatalog,
    ignoredRecords,
    invariants: {
      candidateLikeRecordCount: sessionCandidates.length,
      noSilentLoss: sessionCandidates.length === recognizedCohortMarkers,
      recognizedCohortMarkers,
    },
    masterTable: masterTableDescriptor,
    parserVersion: HIT_MASTER_PARSER_VERSION,
    referenceTables,
    sessionCandidates,
    sourceMetadata: {
      contentHash: input.contentHash,
      externalFileId: input.payload.fileId,
      fileName: input.payload.fileName,
      observedAt: input.payload.observedAt,
      sourceKey: input.sourceKey,
      tabCount: input.payload.tabs.length,
      tableCount: input.payload.tabs.reduce(
        (total: number, tab: GoogleDocsSourceSnapshot["tabs"][number]) =>
          total + tab.tables.length,
        0,
      ),
    },
    status,
    summary,
    warnings,
  };
}
