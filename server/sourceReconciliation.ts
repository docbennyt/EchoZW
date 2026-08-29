import { createHash } from "node:crypto";

import type { HitSourceProvenance } from "../src/domain/hitMasterSnapshotParser.js";

export type ReconciliationBinding = {
  sourceCohortCode: string;
  sourceKey: string;
  targetAcademicPeriodName: string;
  targetClassGroupLabel: string;
  targetPublicSlug: string;
};

export type ReconciliationSourceCandidate = {
  candidateId: string;
  cohortCode: string;
  courseCode: string | null;
  courseExpressionRaw: string;
  courseName: string | null;
  endTime: string | null;
  lecturer: string | null;
  parseRunId: string;
  parserProvenance: HitSourceProvenance;
  parserVersion: string;
  parseWarnings: Array<Record<string, unknown>>;
  reviewStatus: "invalid" | "valid" | "warning";
  snapshotId: string;
  sourceCandidateKey: string;
  sourceKey: string;
  startTime: string | null;
  venue: string | null;
  weekday: number | null;
};

export type ReconciliationCurrentSession = {
  courseCode: string;
  courseName: string;
  endTime: string;
  lecturer: string | null;
  notes: string | null;
  publishedVersionId: string;
  sessionId: string;
  sessionType: string | null;
  stableSessionKey: string | null;
  startTime: string;
  timetableId: string;
  venue: string | null;
  weekday: number;
};

export type ReconciliationDiffField =
  | "courseCode"
  | "courseName"
  | "endTime"
  | "lecturer"
  | "startTime"
  | "venue"
  | "weekday";

export type ReconciliationDiff = {
  current: string | number | null;
  field: ReconciliationDiffField;
  source: string | number | null;
};

export type ReconciliationItem = {
  currentSessions: ReconciliationCurrentSession[];
  diffs: ReconciliationDiff[];
  id: string;
  matchStrategy:
    | "ambiguous_group"
    | "exact_course_day_time"
    | "source_only"
    | "current_only"
    | "unique_course_day_plausible_shift";
  outcome: "ambiguous" | "changed" | "current_only" | "matched" | "source_only";
  sourceCandidates: ReconciliationSourceCandidate[];
};

export type SourceReconciliationResult = {
  binding: ReconciliationBinding;
  cohort: string;
  invariants: {
    currentSessionCount: number;
    currentSessionsCovered: number;
    noSilentLoss: boolean;
    sourceCandidateCount: number;
    sourceCandidatesCovered: number;
  };
  items: ReconciliationItem[];
  publishedVersionId: string;
  sourceSnapshotId: string;
  summary: {
    ambiguous: number;
    changed: number;
    currentOnly: number;
    matched: number;
    sourceOnly: number;
  };
  timetableId: string;
};

function createDeterministicId(prefix: string, seed: string) {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function normalizeWhitespace(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextForComparison(value: string | null | undefined) {
  return normalizeWhitespace(value).toUpperCase();
}

function normalizeCourseCode(value: string | null | undefined) {
  const normalized = normalizeTextForComparison(value).replace(/\s+/g, "");
  return normalized || null;
}

function normalizeCourseName(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized || null;
}

function normalizeTimeValue(value: string | null | undefined) {
  const match = normalizeWhitespace(value).match(
    /^(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function sourceSortKey(candidate: ReconciliationSourceCandidate) {
  return [
    String(candidate.weekday ?? 99).padStart(2, "0"),
    normalizeTimeValue(candidate.startTime) ?? "99:99:99",
    normalizeTimeValue(candidate.endTime) ?? "99:99:99",
    normalizeCourseCode(candidate.courseCode) ??
      normalizeTextForComparison(candidate.courseExpressionRaw),
    candidate.candidateId,
  ].join("|");
}

function currentSortKey(session: ReconciliationCurrentSession) {
  return [
    String(session.weekday).padStart(2, "0"),
    normalizeTimeValue(session.startTime) ?? "99:99:99",
    normalizeTimeValue(session.endTime) ?? "99:99:99",
    normalizeCourseCode(session.courseCode) ?? "",
    session.sessionId,
  ].join("|");
}

function itemSortKey(item: ReconciliationItem) {
  const firstSource = item.sourceCandidates[0];
  const firstCurrent = item.currentSessions[0];
  return [
    firstSource ? sourceSortKey(firstSource) : "zzzz",
    firstCurrent ? currentSortKey(firstCurrent) : "zzzz",
    item.outcome,
    item.id,
  ].join("|");
}

function compareSourceCandidates(
  left: ReconciliationSourceCandidate,
  right: ReconciliationSourceCandidate,
) {
  return sourceSortKey(left).localeCompare(sourceSortKey(right));
}

function compareCurrentSessions(
  left: ReconciliationCurrentSession,
  right: ReconciliationCurrentSession,
) {
  return currentSortKey(left).localeCompare(currentSortKey(right));
}

function sourceCourseKey(candidate: ReconciliationSourceCandidate) {
  return normalizeCourseCode(candidate.courseCode);
}

function currentCourseKey(session: ReconciliationCurrentSession) {
  return normalizeCourseCode(session.courseCode);
}

function createExactMatchKey(
  courseCode: string | null,
  weekday: number | null,
  startTime: string | null,
  endTime: string | null,
) {
  if (!courseCode || weekday === null) return null;
  const normalizedStart = normalizeTimeValue(startTime);
  const normalizedEnd = normalizeTimeValue(endTime);
  if (!normalizedStart || !normalizedEnd) return null;
  return [courseCode, weekday, normalizedStart, normalizedEnd].join("|");
}

function createCourseDayKey(courseCode: string | null, weekday: number | null) {
  if (!courseCode || weekday === null) return null;
  return [courseCode, weekday].join("|");
}

function groupBy<T>(entries: T[], keyFor: (entry: T) => string | null) {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyFor(entry);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return grouped;
}

function minutesSinceMidnight(value: string | null | undefined) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [hours, minutes, seconds] = normalized.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function isPlausibleUniqueShift(
  source: ReconciliationSourceCandidate,
  current: ReconciliationCurrentSession,
) {
  const sourceStart = minutesSinceMidnight(source.startTime);
  const sourceEnd = minutesSinceMidnight(source.endTime);
  const currentStart = minutesSinceMidnight(current.startTime);
  const currentEnd = minutesSinceMidnight(current.endTime);
  if (
    sourceStart === null ||
    sourceEnd === null ||
    currentStart === null ||
    currentEnd === null
  ) {
    return false;
  }

  const overlaps = sourceStart < currentEnd && sourceEnd > currentStart;
  const maxDelta = Math.max(
    Math.abs(sourceStart - currentStart),
    Math.abs(sourceEnd - currentEnd),
  );
  return overlaps || maxDelta <= 90;
}

function buildDiffs(
  source: ReconciliationSourceCandidate,
  current: ReconciliationCurrentSession,
) {
  const diffs: ReconciliationDiff[] = [];
  const pairs: Array<{
    current: string | number | null;
    currentNormalized: string | number | null;
    field: ReconciliationDiffField;
    source: string | number | null;
    sourceNormalized: string | number | null;
  }> = [
    {
      current: current.courseCode,
      currentNormalized: normalizeCourseCode(current.courseCode),
      field: "courseCode",
      source: source.courseCode,
      sourceNormalized: normalizeCourseCode(source.courseCode),
    },
    {
      current: current.courseName,
      currentNormalized: normalizeCourseName(current.courseName),
      field: "courseName",
      source: source.courseName,
      sourceNormalized: normalizeCourseName(source.courseName),
    },
    {
      current: current.weekday,
      currentNormalized: current.weekday,
      field: "weekday",
      source: source.weekday,
      sourceNormalized: source.weekday,
    },
    {
      current: current.startTime,
      currentNormalized: normalizeTimeValue(current.startTime),
      field: "startTime",
      source: source.startTime,
      sourceNormalized: normalizeTimeValue(source.startTime),
    },
    {
      current: current.endTime,
      currentNormalized: normalizeTimeValue(current.endTime),
      field: "endTime",
      source: source.endTime,
      sourceNormalized: normalizeTimeValue(source.endTime),
    },
    {
      current: current.venue,
      currentNormalized: normalizeTextForComparison(current.venue),
      field: "venue",
      source: source.venue,
      sourceNormalized: normalizeTextForComparison(source.venue),
    },
    {
      current: current.lecturer,
      currentNormalized: normalizeTextForComparison(current.lecturer),
      field: "lecturer",
      source: source.lecturer,
      sourceNormalized: normalizeTextForComparison(source.lecturer),
    },
  ];

  for (const pair of pairs) {
    if (pair.sourceNormalized === pair.currentNormalized) continue;
    diffs.push({
      current: pair.current,
      field: pair.field,
      source: pair.source,
    });
  }

  return diffs;
}

function buildPairedItem(input: {
  current: ReconciliationCurrentSession;
  matchStrategy: ReconciliationItem["matchStrategy"];
  source: ReconciliationSourceCandidate;
}) {
  const diffs = buildDiffs(input.source, input.current);
  const outcome = diffs.length > 0 ? "changed" : "matched";
  return {
    currentSessions: [input.current],
    diffs,
    id: createDeterministicId(
      "reconcile",
      [
        input.matchStrategy,
        input.source.candidateId,
        input.current.sessionId,
        outcome,
      ].join("|"),
    ),
    matchStrategy: input.matchStrategy,
    outcome,
    sourceCandidates: [input.source],
  } satisfies ReconciliationItem;
}

function buildSingleSidedItem(input: {
  current?: ReconciliationCurrentSession;
  source?: ReconciliationSourceCandidate;
}) {
  const outcome = input.source ? "source_only" : "current_only";
  const sourceCandidates = input.source ? [input.source] : [];
  const currentSessions = input.current ? [input.current] : [];

  return {
    currentSessions,
    diffs: [],
    id: createDeterministicId(
      "reconcile",
      [
        outcome,
        input.source?.candidateId ?? "",
        input.current?.sessionId ?? "",
      ].join("|"),
    ),
    matchStrategy: outcome,
    outcome,
    sourceCandidates,
  } satisfies ReconciliationItem;
}

function buildAmbiguousItem(input: {
  currentSessions: ReconciliationCurrentSession[];
  sourceCandidates: ReconciliationSourceCandidate[];
}) {
  const sourceCandidates = [...input.sourceCandidates].sort(
    compareSourceCandidates,
  );
  const currentSessions = [...input.currentSessions].sort(
    compareCurrentSessions,
  );
  return {
    currentSessions,
    diffs: [],
    id: createDeterministicId(
      "reconcile",
      [
        "ambiguous",
        ...sourceCandidates.map((candidate) => candidate.candidateId),
        "::",
        ...currentSessions.map((session) => session.sessionId),
      ].join("|"),
    ),
    matchStrategy: "ambiguous_group",
    outcome: "ambiguous",
    sourceCandidates,
  } satisfies ReconciliationItem;
}

function countSummary(items: ReconciliationItem[]) {
  return items.reduce(
    (summary, item) => {
      if (item.outcome === "matched") summary.matched += 1;
      if (item.outcome === "changed") summary.changed += 1;
      if (item.outcome === "source_only") summary.sourceOnly += 1;
      if (item.outcome === "current_only") summary.currentOnly += 1;
      if (item.outcome === "ambiguous") summary.ambiguous += 1;
      return summary;
    },
    {
      ambiguous: 0,
      changed: 0,
      currentOnly: 0,
      matched: 0,
      sourceOnly: 0,
    },
  );
}

function assertConservationInvariant(
  items: ReconciliationItem[],
  sourceCandidates: ReconciliationSourceCandidate[],
  currentSessions: ReconciliationCurrentSession[],
) {
  const seenSourceIds = new Map<string, number>();
  const seenCurrentIds = new Map<string, number>();

  for (const item of items) {
    for (const source of item.sourceCandidates) {
      seenSourceIds.set(
        source.candidateId,
        (seenSourceIds.get(source.candidateId) ?? 0) + 1,
      );
    }
    for (const current of item.currentSessions) {
      seenCurrentIds.set(
        current.sessionId,
        (seenCurrentIds.get(current.sessionId) ?? 0) + 1,
      );
    }
  }

  const sourceCandidatesCovered = [...seenSourceIds.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const currentSessionsCovered = [...seenCurrentIds.values()].reduce(
    (total, count) => total + count,
    0,
  );

  const noSilentLoss =
    sourceCandidates.every(
      (candidate) => seenSourceIds.get(candidate.candidateId) === 1,
    ) &&
    currentSessions.every(
      (session) => seenCurrentIds.get(session.sessionId) === 1,
    );

  if (!noSilentLoss) {
    throw new Error(
      "Source reconciliation violated the conservation invariant for source candidates or current sessions.",
    );
  }

  return {
    currentSessionCount: currentSessions.length,
    currentSessionsCovered,
    noSilentLoss,
    sourceCandidateCount: sourceCandidates.length,
    sourceCandidatesCovered,
  };
}

export function reconcileSourceCandidatesToPublishedTimetable(input: {
  binding: ReconciliationBinding;
  cohort: string;
  currentSessions: ReconciliationCurrentSession[];
  publishedVersionId: string;
  sourceCandidates: ReconciliationSourceCandidate[];
  sourceSnapshotId: string;
  timetableId: string;
}) {
  const sourceCandidates = [...input.sourceCandidates].sort(
    compareSourceCandidates,
  );
  const currentSessions = [...input.currentSessions].sort(
    compareCurrentSessions,
  );
  const items: ReconciliationItem[] = [];
  const consumedSourceIds = new Set<string>();
  const consumedCurrentIds = new Set<string>();

  const sourceExactGroups = groupBy(sourceCandidates, (candidate) =>
    createExactMatchKey(
      sourceCourseKey(candidate),
      candidate.weekday,
      candidate.startTime,
      candidate.endTime,
    ),
  );
  const currentExactGroups = groupBy(currentSessions, (session) =>
    createExactMatchKey(
      currentCourseKey(session),
      session.weekday,
      session.startTime,
      session.endTime,
    ),
  );
  const exactKeys = [
    ...new Set([...sourceExactGroups.keys(), ...currentExactGroups.keys()]),
  ].sort();

  for (const key of exactKeys) {
    const sourceGroup = (sourceExactGroups.get(key) ?? []).filter(
      (candidate) => !consumedSourceIds.has(candidate.candidateId),
    );
    const currentGroup = (currentExactGroups.get(key) ?? []).filter(
      (session) => !consumedCurrentIds.has(session.sessionId),
    );

    if (sourceGroup.length === 0 && currentGroup.length === 0) continue;
    if (sourceGroup.length === 1 && currentGroup.length === 1) {
      items.push(
        buildPairedItem({
          current: currentGroup[0],
          matchStrategy: "exact_course_day_time",
          source: sourceGroup[0],
        }),
      );
      consumedSourceIds.add(sourceGroup[0].candidateId);
      consumedCurrentIds.add(currentGroup[0].sessionId);
      continue;
    }

    if (sourceGroup.length > 0 && currentGroup.length > 0) {
      items.push(
        buildAmbiguousItem({
          currentSessions: currentGroup,
          sourceCandidates: sourceGroup,
        }),
      );
      sourceGroup.forEach((candidate) =>
        consumedSourceIds.add(candidate.candidateId),
      );
      currentGroup.forEach((session) =>
        consumedCurrentIds.add(session.sessionId),
      );
      continue;
    }

    continue;
  }

  const remainingSources = sourceCandidates.filter(
    (candidate) => !consumedSourceIds.has(candidate.candidateId),
  );
  const remainingCurrents = currentSessions.filter(
    (session) => !consumedCurrentIds.has(session.sessionId),
  );
  const sourceDayGroups = groupBy(remainingSources, (candidate) =>
    createCourseDayKey(sourceCourseKey(candidate), candidate.weekday),
  );
  const currentDayGroups = groupBy(remainingCurrents, (session) =>
    createCourseDayKey(currentCourseKey(session), session.weekday),
  );
  const dayKeys = [
    ...new Set([...sourceDayGroups.keys(), ...currentDayGroups.keys()]),
  ].sort();

  for (const key of dayKeys) {
    const sourceGroup = (sourceDayGroups.get(key) ?? []).filter(
      (candidate) => !consumedSourceIds.has(candidate.candidateId),
    );
    const currentGroup = (currentDayGroups.get(key) ?? []).filter(
      (session) => !consumedCurrentIds.has(session.sessionId),
    );

    if (sourceGroup.length === 0 && currentGroup.length === 0) continue;
    if (sourceGroup.length === 1 && currentGroup.length === 1) {
      if (isPlausibleUniqueShift(sourceGroup[0], currentGroup[0])) {
        items.push(
          buildPairedItem({
            current: currentGroup[0],
            matchStrategy: "unique_course_day_plausible_shift",
            source: sourceGroup[0],
          }),
        );
      } else {
        items.push(buildSingleSidedItem({ source: sourceGroup[0] }));
        items.push(buildSingleSidedItem({ current: currentGroup[0] }));
      }
      consumedSourceIds.add(sourceGroup[0].candidateId);
      consumedCurrentIds.add(currentGroup[0].sessionId);
      continue;
    }

    if (sourceGroup.length > 0 && currentGroup.length > 0) {
      items.push(
        buildAmbiguousItem({
          currentSessions: currentGroup,
          sourceCandidates: sourceGroup,
        }),
      );
      sourceGroup.forEach((candidate) =>
        consumedSourceIds.add(candidate.candidateId),
      );
      currentGroup.forEach((session) =>
        consumedCurrentIds.add(session.sessionId),
      );
      continue;
    }

    continue;
  }

  for (const source of sourceCandidates) {
    if (consumedSourceIds.has(source.candidateId)) continue;
    items.push(buildSingleSidedItem({ source }));
    consumedSourceIds.add(source.candidateId);
  }

  for (const current of currentSessions) {
    if (consumedCurrentIds.has(current.sessionId)) continue;
    items.push(buildSingleSidedItem({ current }));
    consumedCurrentIds.add(current.sessionId);
  }

  const orderedItems = items.sort((left, right) =>
    itemSortKey(left).localeCompare(itemSortKey(right)),
  );
  const invariants = assertConservationInvariant(
    orderedItems,
    sourceCandidates,
    currentSessions,
  );

  return {
    binding: input.binding,
    cohort: input.cohort,
    invariants,
    items: orderedItems,
    publishedVersionId: input.publishedVersionId,
    sourceSnapshotId: input.sourceSnapshotId,
    summary: countSummary(orderedItems),
    timetableId: input.timetableId,
  } satisfies SourceReconciliationResult;
}
