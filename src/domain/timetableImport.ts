export type ImportFeatureFlags = {
  csvImport: boolean;
  docxImport: boolean;
  masterPdfImport: boolean;
  aiExtraction: boolean;
};

export function getImportFeatureFlags(
  env: Record<string, string | undefined> = {},
): ImportFeatureFlags {
  return {
    csvImport: env.VITE_ENABLE_CSV_IMPORT !== "false",
    docxImport: env.VITE_ENABLE_DOCX_IMPORT !== "false",
    masterPdfImport: env.VITE_ENABLE_MASTER_PDF_IMPORT === "true",
    aiExtraction: env.VITE_ENABLE_AI_EXTRACTION === "true",
  };
}

export const importFeatureFlags = getImportFeatureFlags();

export const parserVersion = "calenderzw-import-v1";

export type ImportMode =
  | "cohort_csv"
  | "cohort_docx"
  | "master_pdf_assisted"
  | "course_catalog_from_pdf";

export type CandidateWarningCode =
  | "UNKNOWN_PROGRAMME_PREFIX"
  | "UNKNOWN_COHORT"
  | "UNKNOWN_COURSE"
  | "COURSE_NOT_ASSOCIATED_WITH_PROGRAMME"
  | "AMBIGUOUS_COURSE_CODE"
  | "AMBIGUOUS_SLASHED_COURSE"
  | "DUPLICATE_CANDIDATE"
  | "POSSIBLE_SOURCE_DUPLICATE"
  | "INVALID_TIME_RANGE"
  | "MISSING_VENUE"
  | "UNRECOGNIZED_VENUE_FORMAT"
  | "MULTILINE_ENTRY_SPLIT_UNCERTAIN"
  | "PAGE_BOUNDARY_SESSION"
  | "COURSE_REFERENCE_MISMATCH"
  | "LECTURER_MISMATCH"
  | "SOURCE_MARKED_FIRST_DRAFT"
  | "SEMESTER_DATES_MISSING"
  | "POSSIBLE_TYPO"
  | "BREAK_ROW_IGNORED"
  | "LUNCH_ROW_IGNORED";

export type ImportWarning = {
  code: CandidateWarningCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  fieldName?: string;
  suggestedValue?: string;
};

export type CourseCatalogEntry = {
  programmeCode: string;
  courseCode: string;
  courseName: string;
  lecturer?: string;
  rawText: string;
};

export type ImportCandidate = {
  id: string;
  importMode: ImportMode;
  rawText: string;
  candidateType: "session" | "course_catalog" | "ignored_row" | "non_session";
  programmeCodeRaw?: string;
  cohortCodeRaw?: string;
  courseCodeRaw?: string;
  courseNameRaw?: string;
  dayRaw?: string;
  weekday?: number;
  timeRaw?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  venueRaw?: string;
  venueNormalized?: string;
  lecturerRaw?: string;
  lecturerNormalized?: string;
  sessionType?: string;
  groupLabel?: string;
  notes?: string;
  confidence?: number;
  reviewStatus: "unreviewed" | "valid" | "warning" | "invalid" | "ignored";
  sourcePage?: number;
  sourceTable?: number;
  sourceCell?: string;
  sourceRow?: number;
  warnings: ImportWarning[];
};

export type CsvImportRow = {
  programme_code?: string;
  cohort_code?: string;
  course_code?: string;
  day?: string;
  start_time?: string;
  end_time?: string;
  venue?: string;
  lecturer?: string;
  start_date?: string;
  end_date?: string;
  session_type?: string;
  group?: string;
  notes?: string;
};

export type StructuredDocxRow = {
  day?: string;
  time?: string;
  course?: string;
  venue?: string;
  lecturer?: string;
  sourceRow?: number;
};

export type ImportContext = {
  selectedProgrammeCode?: string;
  selectedCohortCode?: string;
  selectedAcademicPeriodName?: string;
  periodStartsOn?: string;
  periodEndsOn?: string;
  knownProgrammeCodes?: string[];
  knownCohortCodes?: string[];
  knownCourseCodes?: string[];
  programmeCourseCodes?: string[];
  sourceFilename?: string;
};

const weekdayMap: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
};

const programmeNames: Record<string, string> = {
  CS: "Computer Science",
  SE: "Software Engineering",
  IT: "Information Technology",
  ISA: "Information Security and Assurance",
};

export function parseCohortCode(value: string) {
  const match = value.trim().match(/^([A-Z]{2,3})\.(\d+)$/i);
  if (!match) return null;
  return {
    programmeCode: match[1].toUpperCase(),
    cohortCode: `${match[1].toUpperCase()}.${match[2]}`,
    levelLabel: match[2],
  };
}

export function parseTimeRange(value: string) {
  const normalized = value.replace(/[\u2013\u2014]/g, "-").trim();
  const match = normalized.match(/(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})/);
  if (!match) return null;
  const start = `${match[1].padStart(2, "0")}:${match[2]}`;
  const end = `${match[3].padStart(2, "0")}:${match[4]}`;
  return { start, end };
}

export function parseWeekday(value?: string) {
  if (!value) return undefined;
  return weekdayMap[value.trim().toLowerCase()];
}

export function splitCourseCodeAndName(value = "") {
  const compact = value.replace(/\s+/g, " ").trim();
  const match = compact.match(
    /^([A-Z]{2,4}\d{3,4}(?:\/[A-Z]{2,4}\d{3,4})?)\s*[-:\u2013\u2014]?\s*(.*)$/i,
  );
  if (!match) {
    return { courseName: compact || undefined };
  }
  return {
    courseCode: match[1].toUpperCase(),
    courseName: match[2]?.trim() || undefined,
  };
}

export function normalizeVenue(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(N\d{3})\s*[- ]?\s*LAB\b/i, "$1-LAB")
    .trim();
}

export function normalizeLecturer(value?: string) {
  if (!value) return undefined;
  return value.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
}

function candidateId(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `cand_${hash.toString(16).padStart(8, "0")}`;
}

function reviewStatus(warnings: ImportWarning[]) {
  if (warnings.some((warning) => warning.severity === "blocking"))
    return "invalid";
  if (warnings.length) return "warning";
  return "valid";
}

function baseWarnings(
  input: {
    programmeCode?: string;
    cohortCode?: string;
    courseCode?: string;
    venue?: string;
    startTime?: string;
    endTime?: string;
    sourceFilename?: string;
    periodStartsOn?: string;
    periodEndsOn?: string;
  },
  context: ImportContext,
) {
  const warnings: ImportWarning[] = [];
  const knownProgrammeCodes = new Set(context.knownProgrammeCodes ?? []);
  const knownCohortCodes = new Set(context.knownCohortCodes ?? []);
  const knownCourseCodes = new Set(context.knownCourseCodes ?? []);
  const programmeCourseCodes = new Set(context.programmeCourseCodes ?? []);

  if (input.programmeCode && input.programmeCode === "ISE") {
    warnings.push({
      code: "POSSIBLE_TYPO",
      severity: "warning",
      message: "Programme prefix ISE may be a typo where SE is expected.",
      fieldName: "programme_code",
      suggestedValue: "SE",
    });
  }
  if (knownProgrammeCodes.size && input.programmeCode && !knownProgrammeCodes.has(input.programmeCode)) {
    warnings.push({
      code: "UNKNOWN_PROGRAMME_PREFIX",
      severity: "blocking",
      message: `Unknown programme prefix ${input.programmeCode}.`,
      fieldName: "programme_code",
    });
  }
  if (knownCohortCodes.size && input.cohortCode && !knownCohortCodes.has(input.cohortCode)) {
    warnings.push({
      code: "UNKNOWN_COHORT",
      severity: "blocking",
      message: `Unknown cohort ${input.cohortCode}.`,
      fieldName: "cohort_code",
    });
  }
  if (knownCourseCodes.size && input.courseCode && !knownCourseCodes.has(input.courseCode)) {
    warnings.push({
      code: "UNKNOWN_COURSE",
      severity: "blocking",
      message: `Unknown course ${input.courseCode}.`,
      fieldName: "course_code",
    });
  }
  if (programmeCourseCodes.size && input.courseCode && !programmeCourseCodes.has(input.courseCode)) {
    warnings.push({
      code: "COURSE_NOT_ASSOCIATED_WITH_PROGRAMME",
      severity: "blocking",
      message: `${input.courseCode} is not associated with the selected programme.`,
      fieldName: "course_code",
    });
  }
  if (input.courseCode?.includes("/")) {
    warnings.push({
      code: "AMBIGUOUS_SLASHED_COURSE",
      severity: "warning",
      message: "Slash-separated course code requires human review.",
      fieldName: "course_code",
    });
  }
  if (!input.venue) {
    warnings.push({
      code: "MISSING_VENUE",
      severity: "warning",
      message: "Venue is missing.",
      fieldName: "venue",
    });
  } else if (/\bN\d{3}LAB\b/i.test(input.venue) || /\bN\d{3}\s+LAB\b/i.test(input.venue)) {
    warnings.push({
      code: "UNRECOGNIZED_VENUE_FORMAT",
      severity: "warning",
      message: "Lab venue formatting is inconsistent and should be normalized.",
      fieldName: "venue",
      suggestedValue: normalizeVenue(input.venue),
    });
  }
  if (input.startTime && input.endTime && input.endTime <= input.startTime) {
    warnings.push({
      code: "INVALID_TIME_RANGE",
      severity: "blocking",
      message: "Session end time must be after start time.",
      fieldName: "time",
    });
  }
  if (input.sourceFilename && /first draft/i.test(input.sourceFilename)) {
    warnings.push({
      code: "SOURCE_MARKED_FIRST_DRAFT",
      severity: "warning",
      message: "Source filename indicates this timetable is a first draft.",
      fieldName: "source",
    });
  }
  if (!input.periodStartsOn || !input.periodEndsOn) {
    warnings.push({
      code: "SEMESTER_DATES_MISSING",
      severity: "blocking",
      message: "Academic period start and end dates must be supplied before confirmation.",
      fieldName: "academic_period",
    });
  }

  return warnings;
}

export function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0] ?? "").map((header) =>
    header.trim().toLowerCase(),
  );
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index]?.trim() ?? ""]),
    ) as CsvImportRow;
  });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function createCandidatesFromCsv(
  text: string,
  context: ImportContext,
) {
  return parseCsv(text).map((row, index) => {
    const programmeCode =
      row.programme_code?.toUpperCase() ?? context.selectedProgrammeCode;
    const cohortCode = row.cohort_code?.toUpperCase() ?? context.selectedCohortCode;
    const weekday = parseWeekday(row.day);
    const warnings: ImportWarning[] = [];
    const required: Array<[keyof CsvImportRow, string]> = [
      ["course_code", "course_code"],
      ["day", "day"],
      ["start_time", "start_time"],
      ["end_time", "end_time"],
      ["venue", "venue"],
    ];
    for (const [field, label] of required) {
      if (!row[field]) {
        warnings.push({
          code: field === "venue" ? "MISSING_VENUE" : "POSSIBLE_TYPO",
          severity: field === "venue" ? "warning" : "blocking",
          message: `${label} is required.`,
          fieldName: label,
        });
      }
    }
    if (!weekday) {
      warnings.push({
        code: "POSSIBLE_TYPO",
        severity: "blocking",
        message: "Weekday is not recognized.",
        fieldName: "day",
      });
    }
    warnings.push(
      ...baseWarnings(
        {
          programmeCode,
          cohortCode,
          courseCode: row.course_code?.toUpperCase(),
          venue: row.venue,
          startTime: row.start_time,
          endTime: row.end_time,
          sourceFilename: context.sourceFilename,
          periodStartsOn: row.start_date ?? context.periodStartsOn,
          periodEndsOn: row.end_date ?? context.periodEndsOn,
        },
        context,
      ),
    );
    return {
      id: candidateId(`csv:${index}:${JSON.stringify(row)}`),
      importMode: "cohort_csv",
      rawText: Object.values(row).join(" | "),
      candidateType: "session",
      programmeCodeRaw: programmeCode,
      cohortCodeRaw: cohortCode,
      courseCodeRaw: row.course_code?.toUpperCase(),
      dayRaw: row.day,
      weekday,
      timeRaw: `${row.start_time ?? ""}-${row.end_time ?? ""}`,
      startTime: row.start_time,
      endTime: row.end_time,
      startDate: row.start_date ?? context.periodStartsOn,
      endDate: row.end_date ?? context.periodEndsOn,
      venueRaw: row.venue,
      venueNormalized: normalizeVenue(row.venue),
      lecturerRaw: row.lecturer,
      lecturerNormalized: normalizeLecturer(row.lecturer),
      sessionType: row.session_type || "Lecture",
      groupLabel: row.group || undefined,
      notes: sanitizeCsvText(row.notes),
      confidence: warnings.some((warning) => warning.severity === "blocking")
        ? 0.4
        : 0.95,
      reviewStatus: reviewStatus(warnings),
      sourceRow: index + 2,
      warnings,
    } satisfies ImportCandidate;
  });
}

export function createCandidatesFromStructuredDocxRows(
  rows: StructuredDocxRow[],
  context: ImportContext,
) {
  let currentDay = "";
  return rows
    .map((row, index) => {
      if (row.day?.trim()) currentDay = row.day.trim();
      const time = parseTimeRange(row.time ?? "");
      const course = splitCourseCodeAndName(row.course);
      const warnings = baseWarnings(
        {
          programmeCode: context.selectedProgrammeCode,
          cohortCode: context.selectedCohortCode,
          courseCode: course.courseCode,
          venue: row.venue,
          startTime: time?.start,
          endTime: time?.end,
          sourceFilename: context.sourceFilename,
          periodStartsOn: context.periodStartsOn,
          periodEndsOn: context.periodEndsOn,
        },
        context,
      );
      if (!time) {
        warnings.push({
          code: "INVALID_TIME_RANGE",
          severity: "blocking",
          message: "DOCX time range could not be parsed.",
          fieldName: "time",
        });
      }
      return {
        id: candidateId(`docx:${index}:${JSON.stringify(row)}`),
        importMode: "cohort_docx",
        rawText: [currentDay, row.time, row.course, row.venue, row.lecturer]
          .filter(Boolean)
          .join(" | "),
        candidateType: "session",
        programmeCodeRaw: context.selectedProgrammeCode,
        cohortCodeRaw: context.selectedCohortCode,
        courseCodeRaw: course.courseCode,
        courseNameRaw: course.courseName,
        dayRaw: currentDay,
        weekday: parseWeekday(currentDay),
        timeRaw: row.time,
        startTime: time?.start,
        endTime: time?.end,
        startDate: context.periodStartsOn,
        endDate: context.periodEndsOn,
        venueRaw: row.venue,
        venueNormalized: normalizeVenue(row.venue),
        lecturerRaw: row.lecturer,
        lecturerNormalized: normalizeLecturer(row.lecturer),
        sessionType: "Lecture",
        confidence: warnings.some((warning) => warning.severity === "blocking")
          ? 0.45
          : 0.92,
        reviewStatus: reviewStatus(warnings),
        sourceRow: row.sourceRow ?? index + 1,
        warnings,
      } satisfies ImportCandidate;
    })
    .filter((candidate) => candidate.rawText.trim());
}

export function createCandidatesFromMasterPdfText(
  text: string,
  context: ImportContext,
) {
  const candidates: ImportCandidate[] = [];
  const lines = text.split(/\r?\n/);
  let currentDay = "";
  let currentTime = "";
  let sourcePage = 1;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (/^page\s+\d+/i.test(trimmed)) {
      sourcePage = Number(trimmed.match(/\d+/)?.[0] ?? sourcePage);
      continue;
    }
    if (/^(mon|tues|wednes|thurs|fri)day/i.test(trimmed)) {
      currentDay = trimmed.split(/\s+/)[0];
    }
    const time = parseTimeRange(trimmed);
    if (time) currentTime = `${time.start}-${time.end}`;
    if (/break/i.test(trimmed)) {
      candidates.push(ignoredCandidate(trimmed, "BREAK_ROW_IGNORED", sourcePage, index + 1));
      continue;
    }
    if (/lunch/i.test(trimmed)) {
      candidates.push(ignoredCandidate(trimmed, "LUNCH_ROW_IGNORED", sourcePage, index + 1));
      continue;
    }

    const pattern =
      /\b([A-Z]{2,3}\.\d+)\s+([A-Z]{2,4}\d{3,4}(?:\/[A-Z]{2,4}\d{3,4})?)\s*[-\u2013\u2014]\s*([^|;]+)/gi;
    for (const match of trimmed.matchAll(pattern)) {
      const cohort = parseCohortCode(match[1]);
      const parsedTime = parseTimeRange(currentTime);
      const warnings = baseWarnings(
        {
          programmeCode: cohort?.programmeCode,
          cohortCode: cohort?.cohortCode,
          courseCode: match[2].toUpperCase(),
          venue: match[3].trim(),
          startTime: parsedTime?.start,
          endTime: parsedTime?.end,
          sourceFilename: context.sourceFilename,
          periodStartsOn: context.periodStartsOn,
          periodEndsOn: context.periodEndsOn,
        },
        context,
      );
      candidates.push({
        id: candidateId(`pdf:${sourcePage}:${index}:${match[0]}`),
        importMode: "master_pdf_assisted",
        rawText: match[0],
        candidateType: "session",
        programmeCodeRaw: cohort?.programmeCode,
        cohortCodeRaw: cohort?.cohortCode,
        courseCodeRaw: match[2].toUpperCase(),
        dayRaw: currentDay,
        weekday: parseWeekday(currentDay),
        timeRaw: currentTime,
        startTime: parsedTime?.start,
        endTime: parsedTime?.end,
        startDate: context.periodStartsOn,
        endDate: context.periodEndsOn,
        venueRaw: match[3].trim(),
        venueNormalized: normalizeVenue(match[3].trim()),
        sessionType: "Lecture",
        confidence: 0.65,
        reviewStatus: reviewStatus(warnings),
        sourcePage,
        sourceRow: index + 1,
        warnings,
      });
    }
  }

  return addDuplicateWarnings(candidates);
}

function ignoredCandidate(
  rawText: string,
  code: "BREAK_ROW_IGNORED" | "LUNCH_ROW_IGNORED",
  sourcePage: number,
  sourceRow: number,
) {
  return {
    id: candidateId(`${code}:${sourcePage}:${sourceRow}:${rawText}`),
    importMode: "master_pdf_assisted",
    rawText,
    candidateType: "non_session",
    reviewStatus: "ignored",
    sourcePage,
    sourceRow,
    warnings: [
      {
        code,
        severity: "info",
        message:
          code === "BREAK_ROW_IGNORED"
            ? "Break row ignored."
            : "Lunch row ignored.",
      },
    ],
  } satisfies ImportCandidate;
}

export function groupCandidatesByCohort(candidates: ImportCandidate[]) {
  return candidates.reduce<Record<string, ImportCandidate[]>>((groups, candidate) => {
    const key = candidate.cohortCodeRaw ?? "unassigned";
    groups[key] = [...(groups[key] ?? []), candidate];
    return groups;
  }, {});
}

export function summarizeCohortCandidates(candidates: ImportCandidate[]) {
  return Object.entries(groupCandidatesByCohort(candidates)).map(
    ([cohortCode, cohortCandidates]) => ({
      cohortCode,
      candidates: cohortCandidates.length,
      valid: cohortCandidates.filter((candidate) => candidate.reviewStatus === "valid").length,
      warnings: cohortCandidates.filter((candidate) => candidate.reviewStatus === "warning").length,
      invalid: cohortCandidates.filter((candidate) => candidate.reviewStatus === "invalid").length,
    }),
  );
}

export function detectSessionConflicts(candidates: ImportCandidate[]) {
  const warnings = new Map<string, ImportWarning[]>();
  const sessions = candidates.filter(
    (candidate) =>
      candidate.candidateType === "session" &&
      candidate.weekday &&
      candidate.startTime &&
      candidate.endTime,
  );

  for (let leftIndex = 0; leftIndex < sessions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sessions.length; rightIndex += 1) {
      const left = sessions[leftIndex];
      const right = sessions[rightIndex];
      if (!overlaps(left, right)) continue;
      if (left.cohortCodeRaw === right.cohortCodeRaw) {
        addConflict(warnings, left.id, {
          code: "DUPLICATE_CANDIDATE",
          severity: "blocking",
          message: "Same cohort has overlapping sessions.",
          fieldName: "time",
        });
        addConflict(warnings, right.id, {
          code: "DUPLICATE_CANDIDATE",
          severity: "blocking",
          message: "Same cohort has overlapping sessions.",
          fieldName: "time",
        });
      } else if (
        left.lecturerNormalized &&
        left.lecturerNormalized === right.lecturerNormalized
      ) {
        addConflict(warnings, left.id, {
          code: "LECTURER_MISMATCH",
          severity: "warning",
          message: "Lecturer appears in overlapping sessions across cohorts.",
          fieldName: "lecturer",
        });
      } else if (
        left.venueNormalized &&
        left.venueNormalized === right.venueNormalized
      ) {
        addConflict(warnings, left.id, {
          code: "POSSIBLE_SOURCE_DUPLICATE",
          severity: "warning",
          message: "Venue appears in overlapping sessions across cohorts.",
          fieldName: "venue",
        });
      }
    }
  }

  return warnings;
}

function addConflict(
  warnings: Map<string, ImportWarning[]>,
  candidateIdValue: string,
  warning: ImportWarning,
) {
  warnings.set(candidateIdValue, [...(warnings.get(candidateIdValue) ?? []), warning]);
}

function overlaps(left: ImportCandidate, right: ImportCandidate) {
  return (
    left.weekday === right.weekday &&
    left.startTime! < right.endTime! &&
    right.startTime! < left.endTime!
  );
}

function addDuplicateWarnings(candidates: ImportCandidate[]) {
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const key = [
      candidate.cohortCodeRaw,
      candidate.courseCodeRaw,
      candidate.weekday,
      candidate.startTime,
      candidate.endTime,
      candidate.venueNormalized,
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      return candidate;
    }
    const warnings = [
      ...candidate.warnings,
      {
        code: "POSSIBLE_SOURCE_DUPLICATE" as const,
        severity: "warning" as const,
        message: "Candidate appears duplicated in the source extraction.",
      },
    ];
    return {
      ...candidate,
      warnings,
      reviewStatus: reviewStatus(warnings),
    };
  });
}

function sanitizeCsvText(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^[=+\-@]/.test(trimmed) ? `'${trimmed}` : trimmed;
}

export function buildStableSessionKey(candidate: ImportCandidate) {
  return [
    candidate.programmeCodeRaw,
    candidate.cohortCodeRaw,
    candidate.courseCodeRaw,
    candidate.weekday,
    candidate.startTime,
    candidate.sessionType ?? "Lecture",
    candidate.groupLabel ?? "",
  ]
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9:.-]+/g, "-");
}

export function assertReadyForDraft(candidates: ImportCandidate[]) {
  const approved = candidates.filter(
    (candidate) => candidate.reviewStatus === "valid" || candidate.reviewStatus === "warning",
  );
  const blocking = approved.flatMap((candidate) =>
    candidate.warnings.filter((warning) => warning.severity === "blocking"),
  );
  if (!approved.length) {
    throw new Error("No approved candidates are available for draft creation.");
  }
  if (blocking.length) {
    throw new Error("Blocking warnings must be resolved before draft creation.");
  }
  return approved;
}

export { programmeNames };
