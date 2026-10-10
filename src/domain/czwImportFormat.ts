import { z } from "zod";
import type {
  StaticCourseReference,
  StaticTimetableIgnoredRecord,
  StaticTimetableParseResult,
  StaticTimetableSessionCandidate,
  StaticTimetableWarning,
} from "./staticTimetableDocument.js";

export const CZW_IMPORT_FORMAT_VERSION = "czw-import-format-v1";

const nullableText = z
  .string()
  .trim()
  .transform((value) => (value ? value : null))
  .nullable()
  .optional();

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const czwImportFormatV1Schema = z.object({
  version: z.literal(CZW_IMPORT_FORMAT_VERSION),
  source: z
    .object({
      title: nullableText,
      institutionName: nullableText,
      academicUnitName: nullableText,
      academicYear: nullableText,
      semesterNumber: z.coerce
        .number()
        .int()
        .min(1)
        .max(4)
        .nullable()
        .optional(),
    })
    .default({}),
  targets: z
    .array(
      z.object({
        targetKey: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(250),
        academicUnitName: nullableText,
        yearLevel: z.coerce.number().int().min(1).max(10).nullable().optional(),
        semesterNumber: z.coerce
          .number()
          .int()
          .min(1)
          .max(4)
          .nullable()
          .optional(),
        academicYear: nullableText,
      }),
    )
    .min(1)
    .max(20),
  courses: z
    .array(
      z.object({
        courseCode: z.string().trim().min(1).max(50),
        courseName: z.string().trim().min(1).max(250),
        targetKey: z.string().trim().min(1).max(120).nullable().optional(),
        hoursPerWeek: z.coerce.number().min(0).max(60).nullable().optional(),
        lecturer: nullableText,
        sourceText: nullableText,
      }),
    )
    .max(500)
    .default([]),
  sessions: z
    .array(
      z.object({
        targetKey: z.string().trim().min(1).max(120).nullable().optional(),
        courseCode: z.string().trim().min(1).max(50),
        courseName: z.string().trim().max(250).nullable().optional(),
        weekday: z.coerce.number().int().min(1).max(7),
        weekdayLabel: z.string().trim().max(20).nullable().optional(),
        startTime: timeSchema,
        endTime: timeSchema,
        venue: nullableText,
        lecturer: nullableText,
        deliveryMode: nullableText,
        sourceText: nullableText,
      }),
    )
    .min(1)
    .max(1000),
  issues: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        severity: z.enum(["warning", "error"]),
        message: z.string().trim().min(1).max(500),
        candidateKey: z.string().trim().max(200).nullable().optional(),
        fieldName: z.string().trim().max(80).nullable().optional(),
      }),
    )
    .default([]),
});

export type CzwImportFormatV1 = z.infer<typeof czwImportFormatV1Schema>;

export type CzwImportOperatorContext = {
  programmeName?: string | null;
  scopeLabel?: string | null;
  academicYear?: string | null;
  semesterNumber?: number | null;
};

function compact(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCourseCode(value: string) {
  const collapsed = compact(value).replace(/\s+/g, "").toUpperCase();
  const match = collapsed.match(/^([A-Z]{2,6})(\d{3,5})$/);
  return match ? `${match[1]} ${match[2]}` : compact(value).toUpperCase();
}

function candidateKey(parts: Array<string | number | null | undefined>) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `czw_${(hash >>> 0).toString(16).padStart(8, "0")}_${input.length.toString(16)}`;
}

function parseYearLevel(value: string | null | undefined) {
  const match = compact(value).match(/\b(?:part|year|level)\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function parseSemesterNumber(value: string | null | undefined) {
  const match = compact(value).match(/\bsemester\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function weekdayLabel(weekday: number) {
  return (
    [
      "",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ][weekday] ?? `Day ${weekday}`
  );
}

function durationHours(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  return (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
}

function mergeContextWarnings(input: {
  format: CzwImportFormatV1;
  context?: CzwImportOperatorContext;
  documentCandidateKey: string;
}) {
  const warnings: StaticTimetableWarning[] = [];
  const sourceYear = input.format.source.academicYear ?? null;
  const sourceSemester = input.format.source.semesterNumber ?? null;
  const contextYear = compact(input.context?.academicYear) || null;
  const contextSemester = input.context?.semesterNumber ?? null;

  if (contextYear && sourceYear && contextYear !== sourceYear) {
    warnings.push({
      code: "AMBIGUOUS_DOCUMENT_METADATA",
      severity: "error",
      message: `Operator context says academic year ${contextYear}, but the source says ${sourceYear}.`,
      candidateKey: input.documentCandidateKey,
      fieldName: "academicYear",
      details: {
        operatorContext: contextYear,
        sourceValue: sourceYear,
        provenance: ["operator_context", "source_document"],
      },
    });
  }
  if (
    contextSemester !== null &&
    contextSemester !== undefined &&
    sourceSemester !== null &&
    sourceSemester !== undefined &&
    contextSemester !== sourceSemester
  ) {
    warnings.push({
      code: "AMBIGUOUS_DOCUMENT_METADATA",
      severity: "error",
      message: `Operator context says semester ${contextSemester}, but the source says semester ${sourceSemester}.`,
      candidateKey: input.documentCandidateKey,
      fieldName: "semesterNumber",
      details: {
        operatorContext: contextSemester,
        sourceValue: sourceSemester,
        provenance: ["operator_context", "source_document"],
      },
    });
  }
  return warnings;
}

export function parseCzwImportFormatV1(
  value: unknown,
  options: {
    parserVersion?: string;
    operatorContext?: CzwImportOperatorContext;
  } = {},
): StaticTimetableParseResult {
  const format = czwImportFormatV1Schema.parse(value);
  const targetByKey = new Map(
    format.targets.map((target) => [target.targetKey, target]),
  );
  const documentCandidateKey = candidateKey([
    "document",
    format.source.title,
    format.source.academicYear,
  ]);
  const warnings: StaticTimetableWarning[] = [];
  const courses: StaticCourseReference[] = format.courses.map(
    (course, index) => {
      const target = course.targetKey
        ? targetByKey.get(course.targetKey)
        : null;
      const code = normalizeCourseCode(course.courseCode);
      return {
        candidateKey: candidateKey(["course", index, code, course.courseName]),
        sourceTableIndex: 1,
        sourceRowIndex: index + 1,
        rawCells: [
          course.courseCode,
          course.courseName,
          course.hoursPerWeek === null || course.hoursPerWeek === undefined
            ? ""
            : `${course.hoursPerWeek} hours`,
          course.lecturer ?? "",
        ],
        targetKey: course.targetKey ?? null,
        targetLabel: target?.title ?? null,
        courseCodeRaw: course.courseCode,
        courseCode: code,
        courseName: course.courseName,
        hoursPerWeek: course.hoursPerWeek ?? null,
        lecturerRaw: course.lecturer ?? null,
      };
    },
  );
  const courseByCode = new Map(
    courses.map((course) => [course.courseCode, course]),
  );
  const sessions: StaticTimetableSessionCandidate[] = [];

  for (const [index, session] of format.sessions.entries()) {
    if (session.endTime <= session.startTime) {
      const key = candidateKey([
        "session",
        index,
        session.courseCode,
        session.startTime,
      ]);
      warnings.push({
        code: "INVALID_TIME_RANGE",
        severity: "error",
        message: `${session.courseCode} has an invalid time range ${session.startTime}-${session.endTime}.`,
        candidateKey: key,
        fieldName: "time",
        details: { rowIndex: index + 1 },
      });
      continue;
    }
    const code = normalizeCourseCode(session.courseCode);
    const reference = courseByCode.get(code) ?? null;
    const candidate: StaticTimetableSessionCandidate = {
      candidateKey: candidateKey([
        "session",
        index,
        session.targetKey,
        code,
        session.weekday,
        session.startTime,
        session.endTime,
      ]),
      sourceTableIndex: 0,
      sourceRowIndex: index + 1,
      sourceColumnIndex: 0,
      rawText:
        session.sourceText ??
        [
          session.targetKey,
          session.courseCode,
          session.courseName,
          session.weekdayLabel ?? weekdayLabel(session.weekday),
          `${session.startTime}-${session.endTime}`,
          session.venue,
        ]
          .filter(Boolean)
          .join(" | "),
      weekday: session.weekday,
      weekdayLabel: session.weekdayLabel ?? weekdayLabel(session.weekday),
      startTime: session.startTime,
      endTime: session.endTime,
      courseCodeRaw: session.courseCode,
      courseCode: code,
      courseName: session.courseName || reference?.courseName || null,
      venueRaw: session.venue ?? null,
      deliveryModeRaw: session.deliveryMode ?? null,
      lecturerRaw: session.lecturer ?? reference?.lecturerRaw ?? null,
      warningCodes: [],
    };
    if (!reference && !session.courseName) {
      candidate.warningCodes.push("COURSE_NOT_IN_REFERENCE");
      warnings.push({
        code: "COURSE_NOT_IN_REFERENCE",
        severity: "error",
        message: `${code} appears in the timetable rows but has no course name or course-reference row.`,
        candidateKey: candidate.candidateKey,
        fieldName: "courseCode",
        details: { courseCode: code },
      });
    }
    if (session.deliveryMode) {
      candidate.warningCodes.push("DELIVERY_MODE_REVIEW_REQUIRED");
      warnings.push({
        code: "DELIVERY_MODE_REVIEW_REQUIRED",
        severity: "warning",
        message: `Preserved raw delivery wording “${session.deliveryMode}”; reviewer must confirm its operational meaning.`,
        candidateKey: candidate.candidateKey,
        fieldName: "deliveryMode",
        details: { rawDeliveryMode: session.deliveryMode },
      });
    }
    sessions.push(candidate);
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

  warnings.push(
    ...format.issues.map((issue) => ({
      code: issue.code as StaticTimetableWarning["code"],
      severity: issue.severity,
      message: issue.message,
      candidateKey: issue.candidateKey ?? documentCandidateKey,
      fieldName: issue.fieldName ?? null,
      details: { source: "czw_import_format_v1" },
    })),
    ...mergeContextWarnings({
      format,
      context: options.operatorContext,
      documentCandidateKey,
    }),
  );

  const defaultTarget = format.targets[0] ?? null;
  const metadata = {
    departmentName:
      format.source.academicUnitName ??
      defaultTarget?.academicUnitName ??
      options.operatorContext?.programmeName ??
      null,
    academicYearRaw:
      format.source.academicYear ??
      options.operatorContext?.academicYear ??
      null,
    academicYear:
      Number(
        String(
          format.source.academicYear ??
            options.operatorContext?.academicYear ??
            "",
        ).slice(0, 4),
      ) || null,
    yearLevel:
      defaultTarget?.yearLevel ??
      parseYearLevel(options.operatorContext?.scopeLabel) ??
      null,
    semesterNumber:
      format.source.semesterNumber ??
      defaultTarget?.semesterNumber ??
      options.operatorContext?.semesterNumber ??
      parseSemesterNumber(options.operatorContext?.scopeLabel) ??
      null,
    modeLabel: null,
    title: format.source.title ?? defaultTarget?.title ?? null,
  };
  const ignored: StaticTimetableIgnoredRecord[] = [];
  const timetableContactHours = sessions.reduce(
    (sum, session) => sum + durationHours(session.startTime, session.endTime),
    0,
  );
  const courseReferenceHours = courses.reduce(
    (sum, course) => sum + (course.hoursPerWeek ?? 0),
    0,
  );

  return {
    parserVersion: options.parserVersion ?? CZW_IMPORT_FORMAT_VERSION,
    metadata,
    timetableTableIndex: 0,
    courseReferenceTableIndex: courses.length ? 1 : null,
    courseReferenceTableIndices: courses.length ? [1] : [],
    courses,
    sessions,
    unparsed: [],
    ignored,
    warnings,
    summary: {
      detectedTableCount: courses.length ? 2 : 1,
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
