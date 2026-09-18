export const STATIC_TIMETABLE_DOCX_PARSER_VERSION = "static-docx-matrix-v1";

export type StaticTimetableDocumentStructure = {
  paragraphs: string[];
  tables: string[][][];
};

export type StaticTimetableMetadata = {
  departmentName: string | null;
  academicYear: number | null;
  yearLevel: number | null;
  semesterNumber: number | null;
  modeLabel: string | null;
  title: string | null;
};

export type StaticCourseReference = {
  candidateKey: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  rawCells: string[];
  courseCodeRaw: string;
  courseCode: string;
  courseName: string;
  hoursPerWeek: number | null;
  lecturerRaw: string | null;
};

export type StaticTimetableWarningSeverity = "warning" | "error";

export type StaticTimetableWarning = {
  code:
    | "COURSE_NOT_IN_REFERENCE"
    | "REFERENCE_COURSE_UNUSED"
    | "DELIVERY_MODE_REVIEW_REQUIRED"
    | "MALFORMED_SESSION_CELL"
    | "INVALID_TIME_RANGE"
    | "AMBIGUOUS_DOCUMENT_METADATA";
  severity: StaticTimetableWarningSeverity;
  message: string;
  candidateKey: string | null;
  fieldName: string | null;
  details: Record<string, unknown>;
};

export type StaticTimetableSessionCandidate = {
  candidateKey: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  sourceColumnIndex: number;
  rawText: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
  courseCodeRaw: string;
  courseCode: string;
  courseName: string | null;
  venueRaw: string | null;
  deliveryModeRaw: string | null;
  lecturerRaw: string | null;
  warningCodes: string[];
};

export type StaticTimetableUnparsedCandidate = {
  candidateKey: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  sourceColumnIndex: number;
  rawText: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
};

export type StaticTimetableIgnoredRecord = {
  kind: "break" | "blank";
  sourceTableIndex: number;
  sourceRowIndex: number;
  rawText: string;
  startTime: string | null;
  endTime: string | null;
};

export type StaticTimetableParseResult = {
  parserVersion: typeof STATIC_TIMETABLE_DOCX_PARSER_VERSION;
  metadata: StaticTimetableMetadata;
  timetableTableIndex: number;
  courseReferenceTableIndex: number | null;
  courses: StaticCourseReference[];
  sessions: StaticTimetableSessionCandidate[];
  unparsed: StaticTimetableUnparsedCandidate[];
  ignored: StaticTimetableIgnoredRecord[];
  warnings: StaticTimetableWarning[];
  summary: {
    detectedTableCount: number;
    sessionCount: number;
    timetableContactHours: number;
    courseReferenceCount: number;
    courseReferenceHours: number;
    blockingWarningCount: number;
    warningCount: number;
  };
};

const WEEKDAYS = new Map([
  ["MONDAY", 1],
  ["TUESDAY", 2],
  ["WEDNESDAY", 3],
  ["THURSDAY", 4],
  ["FRIDAY", 5],
  ["SATURDAY", 6],
  ["SUNDAY", 7],
]);

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCourseCode(value: string) {
  const collapsed = compact(value).replace(/\s+/g, "").toUpperCase();
  const match = collapsed.match(/^([A-Z]{2,6})(\d{3,5})$/);
  return match ? `${match[1]} ${match[2]}` : compact(value).toUpperCase();
}

function parseClock(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 3) digits = `0${digits}`;
  if (digits.length !== 4) return null;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseTimeRange(value: string) {
  const match = compact(value).match(
    /^(\d{1,2}:?\d{2})\s*[-–—]\s*(\d{1,2}:?\d{2})$/,
  );
  if (!match) return null;
  const startTime = parseClock(match[1]);
  const endTime = parseClock(match[2]);
  if (!startTime || !endTime || endTime <= startTime) return null;
  return { startTime, endTime };
}

function parseLunchTimeRange(value: string) {
  const match = compact(value).match(
    /^(\d{1,2}:?\d{2}\s*[-–—]\s*\d{1,2}:?\d{2})\s+LUNCH\b/i,
  );
  return match ? parseTimeRange(match[1]) : null;
}

function durationHours(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  return (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
}

function candidateKey(parts: Array<string | number>) {
  const input = parts.join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `static_${(hash >>> 0).toString(16).padStart(8, "0")}_${input.length.toString(16)}`;
}

function headerScore(row: string[]) {
  const names = row.map((cell) => compact(cell).toUpperCase());
  return names.filter((name) => WEEKDAYS.has(name)).length;
}

function detectTimetableTable(tables: string[][][]) {
  let bestIndex = -1;
  let bestScore = -1;

  for (let index = 0; index < tables.length; index += 1) {
    const score = tables[index]
      .slice(0, 4)
      .reduce((max, row) => Math.max(max, headerScore(row)), 0);
    if (score >= 3 && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  if (bestIndex < 0) throw new Error("STATIC_DOCX_TIMETABLE_TABLE_NOT_FOUND");
  return bestIndex;
}

function courseReferenceHeaderIndex(table: string[][]) {
  return table.slice(0, 4).findIndex((row) => {
    const header = row.map((cell) => compact(cell).toUpperCase());
    const hasCourseCode = header.some((cell) => cell.includes("COURSE CODE"));
    const hasTitle = header.some(
      (cell) => cell === "TITLE" || cell.includes("COURSE TITLE"),
    );
    const hasHours = header.some((cell) => cell.includes("HOUR"));
    return hasCourseCode && hasTitle && hasHours;
  });
}

function detectCourseReferenceTable(
  tables: string[][][],
  timetableIndex: number,
) {
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    if (tableIndex === timetableIndex) continue;
    if (courseReferenceHeaderIndex(tables[tableIndex]) >= 0) return tableIndex;
  }
  return null;
}

function parseMetadata(
  structure: StaticTimetableDocumentStructure,
): StaticTimetableMetadata {
  const text = structure.paragraphs.map(compact).filter(Boolean).join("\n");
  const allText = `${text}\n${structure.tables
    .flat(2)
    .map(compact)
    .filter(Boolean)
    .join("\n")}`;
  const departmentLine = allText.match(/Department\s+of\s+([^\n]+)/i)?.[1] ?? null;
  const departmentName = departmentLine
    ? compact(departmentLine)
        .replace(/\s*[-–—:]\s*20\d{2}.*$/i, "")
        .replace(/\s+20\d{2}.*$/i, "")
        .trim() || null
    : null;
  const yearMatch = allText.match(/\b(20\d{2})\b/)?.[1] ?? null;
  const titleMatch = allText.match(
    /Part\s+(\d+)\s+Semester\s+(\d+)\s+([^\n]*?Timetable)/i,
  );
  const mode = titleMatch
    ? compact(titleMatch[3]).replace(/\s*Timetable$/i, "").trim()
    : "";
  return {
    departmentName,
    academicYear: yearMatch ? Number(yearMatch) : null,
    yearLevel: titleMatch ? Number(titleMatch[1]) : null,
    semesterNumber: titleMatch ? Number(titleMatch[2]) : null,
    modeLabel: mode || null,
    title: titleMatch ? compact(titleMatch[0]) : null,
  };
}

function parseCourseReferences(
  table: string[][],
  tableIndex: number,
): StaticCourseReference[] {
  const headerRowIndex = courseReferenceHeaderIndex(table);
  if (headerRowIndex < 0) return [];
  const header = table[headerRowIndex].map((cell) => compact(cell).toUpperCase());
  const courseCodeIndex = header.findIndex((cell) => cell.includes("COURSE CODE"));
  const titleIndex = header.findIndex(
    (cell) => cell === "TITLE" || cell.includes("COURSE TITLE"),
  );
  const hoursIndex = header.findIndex((cell) => cell.includes("HOUR"));
  const lecturerIndex = header.findIndex(
    (cell) => cell.includes("LECTURER") || cell.includes("INSTRUCTOR"),
  );

  return table.slice(headerRowIndex + 1).flatMap((row, offset) => {
    const cells = row.map(compact);
    const courseCodeRaw = cells[courseCodeIndex] ?? "";
    const courseName = cells[titleIndex] ?? "";
    if (!courseCodeRaw || !courseName) return [];
    const hoursMatch = (cells[hoursIndex] ?? "").match(/(\d+(?:\.\d+)?)\s*hour/i);
    const rowIndex = headerRowIndex + offset + 1;
    return [
      {
        candidateKey: candidateKey([
          "course",
          tableIndex,
          rowIndex,
          courseCodeRaw,
          courseName,
        ]),
        sourceTableIndex: tableIndex,
        sourceRowIndex: rowIndex,
        rawCells: cells,
        courseCodeRaw,
        courseCode: normalizeCourseCode(courseCodeRaw),
        courseName,
        hoursPerWeek: hoursMatch ? Number(hoursMatch[1]) : null,
        lecturerRaw: lecturerIndex >= 0 ? cells[lecturerIndex] || null : null,
      },
    ];
  });
}

function parseSessionCell(raw: string) {
  const normalized = raw.replace(/\r/g, "").trim();
  if (!normalized) return null;
  const segments = normalized
    .split("/")
    .map(compact)
    .filter(Boolean);
  const physical = segments[0] ?? "";
  const deliveryModeRaw =
    segments.length > 1 ? segments.slice(1).join(" / ") : null;
  const firstLine = physical
    .split(/\n/)
    .map(compact)
    .filter(Boolean)
    .join(" ");
  const courseMatch = firstLine.match(/^([A-Za-z]{2,6}\s*\d{3,5})\b/i);
  if (!courseMatch) return { malformed: true as const };
  const courseCodeRaw = compact(courseMatch[1]);
  const remainder = compact(firstLine.slice(courseMatch[0].length));
  const parenthesizedVenue = remainder.match(/^\((.+)\)$/);
  const venueRaw = compact(parenthesizedVenue?.[1] ?? remainder) || null;
  return {
    malformed: false as const,
    courseCodeRaw,
    courseCode: normalizeCourseCode(courseCodeRaw),
    venueRaw,
    deliveryModeRaw,
  };
}

function lunchRow(table: string[][], rowIndex: number) {
  const row = table[rowIndex] ?? [];
  return row.some((cell) => compact(cell).toUpperCase() === "LUNCH");
}

export function parseStaticTimetableDocument(
  structure: StaticTimetableDocumentStructure,
): StaticTimetableParseResult {
  if (!Array.isArray(structure.tables) || structure.tables.length === 0) {
    throw new Error("STATIC_DOCX_TABLES_REQUIRED");
  }

  const metadata = parseMetadata(structure);
  const timetableTableIndex = detectTimetableTable(structure.tables);
  const courseReferenceTableIndex = detectCourseReferenceTable(
    structure.tables,
    timetableTableIndex,
  );
  const timetable = structure.tables[timetableTableIndex];
  const courses =
    courseReferenceTableIndex === null
      ? []
      : parseCourseReferences(
          structure.tables[courseReferenceTableIndex],
          courseReferenceTableIndex,
        );
  const courseByCode = new Map(
    courses.map((course) => [course.courseCode, course]),
  );

  const headerRowIndex = timetable.findIndex((row) => headerScore(row) >= 3);
  if (headerRowIndex < 0)
    throw new Error("STATIC_DOCX_WEEKDAY_HEADER_NOT_FOUND");
  const header = timetable[headerRowIndex];
  const weekdayColumns = header
    .map((cell, columnIndex) => ({
      columnIndex,
      label: compact(cell),
      weekday: WEEKDAYS.get(compact(cell).toUpperCase()) ?? null,
    }))
    .filter(
      (
        item,
      ): item is { columnIndex: number; label: string; weekday: number } =>
        item.weekday !== null,
    );

  const sessions: StaticTimetableSessionCandidate[] = [];
  const ignored: StaticTimetableIgnoredRecord[] = [];
  const unparsed: StaticTimetableUnparsedCandidate[] = [];
  const warnings: StaticTimetableWarning[] = [];
  let pendingLunchTime: {
    startTime: string;
    endTime: string;
    rowIndex: number;
    raw: string;
  } | null = null;

  for (
    let rowIndex = headerRowIndex + 1;
    rowIndex < timetable.length;
    rowIndex += 1
  ) {
    const row = timetable[rowIndex] ?? [];
    const timeRaw = compact(row[0] ?? "");
    const inlineLunchTime = timeRaw ? parseLunchTimeRange(timeRaw) : null;
    if (inlineLunchTime) {
      ignored.push({
        kind: "break",
        sourceTableIndex: timetableTableIndex,
        sourceRowIndex: rowIndex,
        rawText: timeRaw,
        startTime: inlineLunchTime.startTime,
        endTime: inlineLunchTime.endTime,
      });
      pendingLunchTime = null;
      continue;
    }

    const time = timeRaw ? parseTimeRange(timeRaw) : null;
    if (timeRaw && !time) {
      warnings.push({
        code: "INVALID_TIME_RANGE",
        severity: "error",
        message: `Could not interpret timetable time range “${timeRaw}”.`,
        candidateKey: null,
        fieldName: "time",
        details: { tableIndex: timetableTableIndex, rowIndex, raw: timeRaw },
      });
      continue;
    }

    if (
      time &&
      weekdayColumns.every(
        ({ columnIndex }) => !compact(row[columnIndex] ?? ""),
      )
    ) {
      pendingLunchTime = { ...time, rowIndex, raw: timeRaw };
      continue;
    }

    if (!time && lunchRow(timetable, rowIndex)) {
      ignored.push({
        kind: "break",
        sourceTableIndex: timetableTableIndex,
        sourceRowIndex: rowIndex,
        rawText: "LUNCH",
        startTime: pendingLunchTime?.startTime ?? null,
        endTime: pendingLunchTime?.endTime ?? null,
      });
      pendingLunchTime = null;
      continue;
    }

    if (!time) continue;
    pendingLunchTime = null;

    for (const { columnIndex, label, weekday } of weekdayColumns) {
      const rawText = (row[columnIndex] ?? "").trim();
      if (!rawText) {
        ignored.push({
          kind: "blank",
          sourceTableIndex: timetableTableIndex,
          sourceRowIndex: rowIndex,
          rawText: "",
          startTime: time.startTime,
          endTime: time.endTime,
        });
        continue;
      }
      const parsed = parseSessionCell(rawText);
      const key = candidateKey([
        "session",
        timetableTableIndex,
        rowIndex,
        columnIndex,
        label,
        time.startTime,
        time.endTime,
        rawText,
      ]);
      if (!parsed || parsed.malformed) {
        unparsed.push({
          candidateKey: key,
          sourceTableIndex: timetableTableIndex,
          sourceRowIndex: rowIndex,
          sourceColumnIndex: columnIndex,
          rawText,
          weekday,
          weekdayLabel: label,
          startTime: time.startTime,
          endTime: time.endTime,
        });
        warnings.push({
          code: "MALFORMED_SESSION_CELL",
          severity: "error",
          message: `Could not safely interpret ${label} ${time.startTime}–${time.endTime}.`,
          candidateKey: key,
          fieldName: "rawText",
          details: {
            tableIndex: timetableTableIndex,
            rowIndex,
            columnIndex,
            rawText,
          },
        });
        continue;
      }

      const reference = courseByCode.get(parsed.courseCode) ?? null;
      const session: StaticTimetableSessionCandidate = {
        candidateKey: key,
        sourceTableIndex: timetableTableIndex,
        sourceRowIndex: rowIndex,
        sourceColumnIndex: columnIndex,
        rawText,
        weekday,
        weekdayLabel: label,
        startTime: time.startTime,
        endTime: time.endTime,
        courseCodeRaw: parsed.courseCodeRaw,
        courseCode: parsed.courseCode,
        courseName: reference?.courseName ?? null,
        venueRaw: parsed.venueRaw,
        deliveryModeRaw: parsed.deliveryModeRaw,
        lecturerRaw: reference?.lecturerRaw ?? null,
        warningCodes: [],
      };

      if (!reference) {
        session.warningCodes.push("COURSE_NOT_IN_REFERENCE");
        warnings.push({
          code: "COURSE_NOT_IN_REFERENCE",
          severity: "error",
          message: `${parsed.courseCode} appears in the timetable grid but has no matching course-reference row.`,
          candidateKey: key,
          fieldName: "courseCode",
          details: { courseCode: parsed.courseCode, rawText },
        });
      }
      if (parsed.deliveryModeRaw) {
        session.warningCodes.push("DELIVERY_MODE_REVIEW_REQUIRED");
        warnings.push({
          code: "DELIVERY_MODE_REVIEW_REQUIRED",
          severity: "warning",
          message: `Preserved raw delivery wording “${parsed.deliveryModeRaw}”; reviewer must confirm its operational meaning.`,
          candidateKey: key,
          fieldName: "deliveryMode",
          details: {
            rawDeliveryMode: parsed.deliveryModeRaw,
            venueRaw: parsed.venueRaw,
          },
        });
      }
      sessions.push(session);
    }
  }

  const usedCodes = new Set(sessions.map((session) => session.courseCode));
  for (const course of courses) {
    if (usedCodes.has(course.courseCode)) continue;
    warnings.push({
      code: "REFERENCE_COURSE_UNUSED",
      severity: "error",
      message: `${course.courseCode} appears in the course-reference table but no timetable session uses that exact code.`,
      candidateKey: course.candidateKey,
      fieldName: "courseCode",
      details: { courseCode: course.courseCode, courseName: course.courseName },
    });
  }

  for (const [fieldName, value] of [
    ["departmentName", metadata.departmentName],
    ["academicYear", metadata.academicYear],
    ["yearLevel", metadata.yearLevel],
    ["semesterNumber", metadata.semesterNumber],
  ] as const) {
    if (value !== null) continue;
    warnings.push({
      code: "AMBIGUOUS_DOCUMENT_METADATA",
      severity: "error",
      message: `Could not deterministically extract ${fieldName} from the document.`,
      candidateKey: null,
      fieldName,
      details: {},
    });
  }

  const timetableContactHours = sessions.reduce(
    (sum, session) =>
      sum + durationHours(session.startTime, session.endTime),
    0,
  );
  const courseReferenceHours = courses.reduce(
    (sum, course) => sum + (course.hoursPerWeek ?? 0),
    0,
  );

  return {
    parserVersion: STATIC_TIMETABLE_DOCX_PARSER_VERSION,
    metadata,
    timetableTableIndex,
    courseReferenceTableIndex,
    courses,
    sessions,
    unparsed,
    ignored,
    warnings,
    summary: {
      detectedTableCount: structure.tables.length,
      sessionCount: sessions.length,
      timetableContactHours,
      courseReferenceCount: courses.length,
      courseReferenceHours,
      blockingWarningCount: warnings.filter(
        (warning) => warning.severity === "error",
      ).length,
      warningCount: warnings.length,
    },
  };
}
