import type {
  StaticCourseReference,
  StaticTimetableParseResult,
} from "./staticTimetableDocument.js";

export type StaticTimetableEvidenceTarget = {
  targetKey: string;
  titleRaw: string;
  departmentNameRaw: string | null;
  yearLevelRaw: string | null;
  yearLevel: number | null;
  semesterRaw: string | null;
  semesterNumber: number | null;
  academicYearRaw: string | null;
  confidence: number;
  normalizedPayload: Record<string, unknown>;
};

export type StaticTimetableCandidateTarget = {
  candidateKey: string;
  targetKey: string;
  applicabilityRaw: string;
  confidence: number;
  reviewStatus: "unreviewed" | "valid" | "warning" | "invalid" | "ignored";
  normalizedPayload: Record<string, unknown>;
};

export type StaticTimetableEvidence = {
  proposedTargets: StaticTimetableEvidenceTarget[];
  candidateTargets: StaticTimetableCandidateTarget[];
};

function fallbackTarget(parsed: StaticTimetableParseResult) {
  const yearLevel = parsed.metadata.yearLevel;
  const semesterNumber = parsed.metadata.semesterNumber;
  const title =
    parsed.metadata.title ??
    [
      yearLevel === null ? null : `Part ${yearLevel}`,
      semesterNumber === null ? null : `Semester ${semesterNumber}`,
      parsed.metadata.departmentName,
    ]
      .filter(Boolean)
      .join(" ");
  return {
    targetKey: "document-default",
    titleRaw: title || "Document timetable",
    departmentNameRaw: parsed.metadata.departmentName,
    yearLevelRaw: yearLevel === null ? null : `Part ${yearLevel}`,
    yearLevel,
    semesterRaw: semesterNumber === null ? null : `Semester ${semesterNumber}`,
    semesterNumber,
    academicYearRaw: parsed.metadata.academicYearRaw,
    confidence:
      yearLevel === null || semesterNumber === null || !parsed.metadata.title
        ? 0.55
        : 0.9,
    normalizedPayload: { source: "document_metadata" },
  };
}

function targetFromCourse(
  parsed: StaticTimetableParseResult,
  course: StaticCourseReference,
) {
  const partMatch = course.targetLabel?.match(
    /\bPart\s+(\d+)\s+Semester\s+(\d+)\b/i,
  );
  const yearLevel = partMatch ? Number(partMatch[1]) : null;
  const semesterNumber = partMatch ? Number(partMatch[2]) : null;
  return {
    targetKey: course.targetKey ?? "document-default",
    titleRaw: course.targetLabel ?? fallbackTarget(parsed).titleRaw,
    departmentNameRaw: parsed.metadata.departmentName,
    yearLevelRaw: yearLevel === null ? null : `Part ${yearLevel}`,
    yearLevel,
    semesterRaw: semesterNumber === null ? null : `Semester ${semesterNumber}`,
    semesterNumber,
    academicYearRaw: parsed.metadata.academicYearRaw,
    confidence: course.targetKey ? 0.9 : 0.55,
    normalizedPayload: {
      source: course.targetKey
        ? "course_reference_heading"
        : "document_metadata",
      sourceTableIndex: course.sourceTableIndex,
    },
  };
}

export function buildStaticTimetableEvidence(
  parsed: StaticTimetableParseResult,
): StaticTimetableEvidence {
  const targetByKey = new Map<string, StaticTimetableEvidenceTarget>();
  const courseTargets = new Map<string, string[]>();

  for (const course of parsed.courses) {
    const target = targetFromCourse(parsed, course);
    targetByKey.set(target.targetKey, target);
    const current = courseTargets.get(course.courseCode) ?? [];
    if (!current.includes(target.targetKey)) current.push(target.targetKey);
    courseTargets.set(course.courseCode, current);
  }

  if (targetByKey.size === 0) {
    const target = fallbackTarget(parsed);
    targetByKey.set(target.targetKey, target);
  }

  const onlyTargetKey =
    targetByKey.size === 1 ? [...targetByKey.keys()][0] : null;
  const candidateTargets: StaticTimetableCandidateTarget[] = [];

  for (const course of parsed.courses) {
    const targetKeys = course.targetKey
      ? [course.targetKey]
      : onlyTargetKey
        ? [onlyTargetKey]
        : [];
    for (const targetKey of targetKeys) {
      candidateTargets.push({
        candidateKey: course.candidateKey,
        targetKey,
        applicabilityRaw:
          course.targetLabel ?? targetByKey.get(targetKey)!.titleRaw,
        confidence: course.targetKey ? 0.95 : 0.55,
        reviewStatus: course.targetKey ? "valid" : "warning",
        normalizedPayload: { source: "course_reference" },
      });
    }
  }

  for (const session of parsed.sessions) {
    const targetKeys = courseTargets.get(session.courseCode) ?? [];
    for (const targetKey of targetKeys) {
      candidateTargets.push({
        candidateKey: session.candidateKey,
        targetKey,
        applicabilityRaw: session.courseCodeRaw,
        confidence: 0.9,
        reviewStatus: session.warningCodes.length ? "warning" : "valid",
        normalizedPayload: { source: "course_reference_membership" },
      });
    }
  }

  if (onlyTargetKey) {
    for (const session of parsed.sessions) {
      if (
        candidateTargets.some(
          (target) => target.candidateKey === session.candidateKey,
        )
      ) {
        continue;
      }
      candidateTargets.push({
        candidateKey: session.candidateKey,
        targetKey: onlyTargetKey,
        applicabilityRaw: targetByKey.get(onlyTargetKey)!.titleRaw,
        confidence: 0.65,
        reviewStatus: "warning",
        normalizedPayload: { source: "single_detected_target" },
      });
    }
  }

  return {
    proposedTargets: [...targetByKey.values()],
    candidateTargets,
  };
}
