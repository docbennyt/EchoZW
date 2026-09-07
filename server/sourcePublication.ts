import { createHash } from "node:crypto";

import type {
  ReconciliationCurrentSession,
  ReconciliationItem,
  ReconciliationSourceCandidate,
  SourceReconciliationResult,
} from "./sourceReconciliation.js";

export const SOURCE_PUBLICATION_POLICY = {
  maxRemovalCount: 3,
  maxRemovalRatio: 0.2,
} as const;

export type PersistedVerifiedReconciliation = {
  id: string;
  parseRunId: string;
  parserVersion: string;
  result: SourceReconciliationResult;
  resultHash: string;
  verifiedAt: string;
};

export type SourcePublicationSession = {
  courseCode: string;
  courseName: string;
  endTime: string;
  lecturer: string | null;
  notes: string | null;
  sessionType: string | null;
  sourceCandidateId: string | null;
  sourceCandidateKey: string | null;
  sourceParseRunId: string | null;
  stableSessionKey: string;
  startTime: string;
  venue: string | null;
  weekday: number;
};

export type SourcePublicationOperation = {
  diffs: ReconciliationItem["diffs"];
  itemId: string;
  kind: "add" | "remove" | "unchanged" | "update";
  sessionId: string | null;
  sourceCandidateId: string | null;
  stableSessionKey: string | null;
};

export type SourcePublicationBlocker = {
  code:
    | "AMBIGUOUS_RECONCILIATION"
    | "BLAST_RADIUS_REMOVAL_COUNT"
    | "BLAST_RADIUS_REMOVAL_RATIO"
    | "DUPLICATE_LOGICAL_SESSION"
    | "DUPLICATE_STABLE_SESSION_KEY"
    | "IDENTITY_COLLISION"
    | "INVALID_RECONCILIATION_INVARIANT"
    | "INVALID_SESSION"
    | "INVALID_SOURCE_CANDIDATE"
    | "OVERLAPPING_SESSIONS"
    | "RECONCILIATION_INPUT_MISMATCH";
  itemId?: string;
  message: string;
};

export type SourcePublicationWarning = {
  code: "SOURCE_PARSE_WARNING";
  itemId: string;
  message: string;
};

export type SourcePublicationPlan = {
  blockers: SourcePublicationBlocker[];
  cohort: string;
  operations: SourcePublicationOperation[];
  parseRunId: string;
  planHash: string;
  policy: typeof SOURCE_PUBLICATION_POLICY;
  previousPublishedVersionId: string;
  reconciliationId: string;
  reconciliationResultHash: string;
  removalSessionIds: string[];
  sessions: SourcePublicationSession[];
  sourceSnapshotId: string;
  summary: {
    additions: number;
    blockers: number;
    removals: number;
    unchanged: number;
    updates: number;
    warnings: number;
  };
  timetableId: string;
  warnings: SourcePublicationWarning[];
};

function canonicalizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalizeJsonValue(
          (value as Record<string, unknown>)[key],
        );
        return result;
      }, {});
  }
  return String(value);
}

export function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function hashCanonicalJson(value: unknown) {
  return createHash("sha256").update(canonicalJsonString(value)).digest("hex");
}

function normalizeWhitespace(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTime(value: string | null | undefined) {
  const match = normalizeWhitespace(value).match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function timeSeconds(value: string) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute, second] = normalized.split(":").map(Number);
  return hour * 3600 + minute * 60 + second;
}

function nullableText(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  return normalized || null;
}

function requiredSourceSessionFields(
  candidate: ReconciliationSourceCandidate,
  itemId: string,
  blockers: SourcePublicationBlocker[],
) {
  const courseCode = normalizeWhitespace(candidate.courseCode);
  const courseName = normalizeWhitespace(candidate.courseName);
  const startTime = normalizeTime(candidate.startTime);
  const endTime = normalizeTime(candidate.endTime);
  const weekday = candidate.weekday;

  if (
    !courseCode ||
    !courseName ||
    weekday === null ||
    !Number.isInteger(weekday) ||
    weekday < 1 ||
    weekday > 7 ||
    !startTime ||
    !endTime ||
    (timeSeconds(endTime) ?? 0) <= (timeSeconds(startTime) ?? 0)
  ) {
    blockers.push({
      code: "INVALID_SOURCE_CANDIDATE",
      itemId,
      message:
        "Source candidate is missing required course/day/time data or has an invalid time range.",
    });
    return null;
  }

  return { courseCode, courseName, endTime, startTime, weekday };
}

function assertExactSourceProvenance(
  candidate: ReconciliationSourceCandidate,
  reconciliation: PersistedVerifiedReconciliation,
  itemId: string,
  blockers: SourcePublicationBlocker[],
) {
  if (
    candidate.snapshotId !== reconciliation.result.sourceSnapshotId ||
    candidate.parseRunId !== reconciliation.parseRunId
  ) {
    blockers.push({
      code: "RECONCILIATION_INPUT_MISMATCH",
      itemId,
      message:
        "A reconciliation item does not belong to the exact persisted snapshot and parse run selected for publication.",
    });
    return false;
  }
  return true;
}

function assertValidSourceCandidate(
  candidate: ReconciliationSourceCandidate,
  reconciliation: PersistedVerifiedReconciliation,
  itemId: string,
  blockers: SourcePublicationBlocker[],
  warnings: SourcePublicationWarning[],
) {
  let valid = assertExactSourceProvenance(
    candidate,
    reconciliation,
    itemId,
    blockers,
  );

  if (candidate.reviewStatus !== "valid") {
    blockers.push({
      code: "INVALID_SOURCE_CANDIDATE",
      itemId,
      message: `Source candidate ${candidate.candidateId} is ${candidate.reviewStatus}; guarded publication accepts only parser-validated source candidates.`,
    });
    valid = false;
  }

  if (candidate.parseWarnings.length > 0) {
    warnings.push({
      code: "SOURCE_PARSE_WARNING",
      itemId,
      message: `Source candidate ${candidate.candidateId} carries ${candidate.parseWarnings.length} parser warning(s) for human review.`,
    });
  }
  return valid;
}

function stableKeyForSourceOnly(input: {
  candidate: ReconciliationSourceCandidate;
  cohort: string;
  sourceKey: string;
}) {
  const seed = [
    input.sourceKey,
    input.cohort,
    input.candidate.sourceCandidateKey,
  ].join("|");
  return `source_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function publicationSessionFromPairedItem(input: {
  candidate: ReconciliationSourceCandidate;
  current: ReconciliationCurrentSession;
  itemId: string;
  parseRunId: string;
  blockers: SourcePublicationBlocker[];
}) {
  const required = requiredSourceSessionFields(
    input.candidate,
    input.itemId,
    input.blockers,
  );
  const stableSessionKey = normalizeWhitespace(input.current.stableSessionKey);
  if (!stableSessionKey) {
    input.blockers.push({
      code: "INVALID_SESSION",
      itemId: input.itemId,
      message:
        "Matched current session has no stable_session_key, so logical identity cannot be preserved safely.",
    });
  }
  if (!required || !stableSessionKey) return null;

  return {
    courseCode: required.courseCode,
    courseName: required.courseName,
    endTime: required.endTime,
    lecturer: nullableText(input.candidate.lecturer),
    notes: nullableText(input.current.notes),
    sessionType: nullableText(input.current.sessionType),
    sourceCandidateId: input.candidate.candidateId,
    sourceCandidateKey: input.candidate.sourceCandidateKey,
    sourceParseRunId: input.parseRunId,
    stableSessionKey,
    startTime: required.startTime,
    venue: nullableText(input.candidate.venue),
    weekday: required.weekday,
  } satisfies SourcePublicationSession;
}

function publicationSessionFromSourceOnly(input: {
  candidate: ReconciliationSourceCandidate;
  cohort: string;
  itemId: string;
  parseRunId: string;
  sourceKey: string;
  blockers: SourcePublicationBlocker[];
}) {
  const required = requiredSourceSessionFields(
    input.candidate,
    input.itemId,
    input.blockers,
  );
  if (!required) return null;

  return {
    courseCode: required.courseCode,
    courseName: required.courseName,
    endTime: required.endTime,
    lecturer: nullableText(input.candidate.lecturer),
    notes: input.candidate.parseWarnings.length
      ? `Source warnings: ${input.candidate.parseWarnings.length}`
      : null,
    sessionType: null,
    sourceCandidateId: input.candidate.candidateId,
    sourceCandidateKey: input.candidate.sourceCandidateKey,
    sourceParseRunId: input.parseRunId,
    stableSessionKey: stableKeyForSourceOnly({
      candidate: input.candidate,
      cohort: input.cohort,
      sourceKey: input.sourceKey,
    }),
    startTime: required.startTime,
    venue: nullableText(input.candidate.venue),
    weekday: required.weekday,
  } satisfies SourcePublicationSession;
}

function operationSortKey(operation: SourcePublicationOperation) {
  return [
    operation.kind,
    operation.stableSessionKey ?? "",
    operation.sessionId ?? "",
    operation.sourceCandidateId ?? "",
    operation.itemId,
  ].join("|");
}

function sessionSortKey(session: SourcePublicationSession) {
  return [
    String(session.weekday).padStart(2, "0"),
    session.startTime,
    session.endTime,
    session.courseCode.toUpperCase(),
    session.stableSessionKey,
  ].join("|");
}

function validateFinalSessions(
  sessions: SourcePublicationSession[],
  blockers: SourcePublicationBlocker[],
) {
  const stableKeys = new Map<string, SourcePublicationSession[]>();
  const logicalKeys = new Map<string, SourcePublicationSession[]>();

  for (const session of sessions) {
    const startSeconds = timeSeconds(session.startTime);
    const endSeconds = timeSeconds(session.endTime);
    if (
      !normalizeWhitespace(session.stableSessionKey) ||
      !normalizeWhitespace(session.courseCode) ||
      !normalizeWhitespace(session.courseName) ||
      !Number.isInteger(session.weekday) ||
      session.weekday < 1 ||
      session.weekday > 7 ||
      startSeconds === null ||
      endSeconds === null ||
      endSeconds <= startSeconds
    ) {
      blockers.push({
        code: "INVALID_SESSION",
        message: `Planned session ${session.stableSessionKey || "(missing key)"} has invalid required data.`,
      });
      continue;
    }

    stableKeys.set(session.stableSessionKey, [
      ...(stableKeys.get(session.stableSessionKey) ?? []),
      session,
    ]);
    const logicalKey = [
      session.courseCode.trim().toUpperCase(),
      session.weekday,
      session.startTime,
      session.endTime,
    ].join("|");
    logicalKeys.set(logicalKey, [
      ...(logicalKeys.get(logicalKey) ?? []),
      session,
    ]);
  }

  for (const [stableSessionKey, group] of stableKeys) {
    if (group.length <= 1) continue;
    blockers.push({
      code: "DUPLICATE_STABLE_SESSION_KEY",
      message: `Plan contains ${group.length} sessions with stable key ${stableSessionKey}.`,
    });
  }

  for (const [logicalKey, group] of logicalKeys) {
    if (group.length <= 1) continue;
    blockers.push({
      code: "DUPLICATE_LOGICAL_SESSION",
      message: `Plan contains ${group.length} duplicate logical sessions (${logicalKey}).`,
    });
  }

  const byDay = new Map<number, SourcePublicationSession[]>();
  for (const session of sessions) {
    byDay.set(session.weekday, [
      ...(byDay.get(session.weekday) ?? []),
      session,
    ]);
  }
  for (const [weekday, daySessions] of byDay) {
    const ordered = [...daySessions].sort((left, right) =>
      sessionSortKey(left).localeCompare(sessionSortKey(right)),
    );
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex += 1
      ) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        const leftStart = timeSeconds(left.startTime);
        const leftEnd = timeSeconds(left.endTime);
        const rightStart = timeSeconds(right.startTime);
        const rightEnd = timeSeconds(right.endTime);
        if (
          leftStart === null ||
          leftEnd === null ||
          rightStart === null ||
          rightEnd === null
        ) {
          continue;
        }
        if (rightStart >= leftEnd) break;
        if (leftStart < rightEnd && leftEnd > rightStart) {
          blockers.push({
            code: "OVERLAPPING_SESSIONS",
            message: `Planned sessions ${left.stableSessionKey} and ${right.stableSessionKey} overlap on weekday ${weekday}.`,
          });
        }
      }
    }
  }
}

function buildPlanPayload(input: Omit<SourcePublicationPlan, "planHash">) {
  return {
    blockers: input.blockers,
    cohort: input.cohort,
    operations: input.operations,
    parseRunId: input.parseRunId,
    policy: input.policy,
    previousPublishedVersionId: input.previousPublishedVersionId,
    reconciliationId: input.reconciliationId,
    reconciliationResultHash: input.reconciliationResultHash,
    removalSessionIds: input.removalSessionIds,
    sessions: input.sessions,
    sourceSnapshotId: input.sourceSnapshotId,
    summary: input.summary,
    timetableId: input.timetableId,
    warnings: input.warnings,
  };
}

export function buildSourcePublicationPlan(
  reconciliation: PersistedVerifiedReconciliation,
): SourcePublicationPlan {
  const result = reconciliation.result;
  const blockers: SourcePublicationBlocker[] = [];
  const warnings: SourcePublicationWarning[] = [];
  const operations: SourcePublicationOperation[] = [];
  const sessions: SourcePublicationSession[] = [];
  const removalSessionIds: string[] = [];
  const existingStableKeys = new Set(
    result.items.flatMap((item) =>
      item.currentSessions
        .map((session) => normalizeWhitespace(session.stableSessionKey))
        .filter(Boolean),
    ),
  );

  if (!result.invariants.noSilentLoss) {
    blockers.push({
      code: "INVALID_RECONCILIATION_INVARIANT",
      message:
        "Persisted reconciliation does not satisfy the source/current conservation invariant.",
    });
  }

  for (const item of result.items) {
    if (item.outcome === "ambiguous") {
      blockers.push({
        code: "AMBIGUOUS_RECONCILIATION",
        itemId: item.id,
        message:
          "Ambiguous reconciliation item requires human/source resolution before publication.",
      });
      continue;
    }

    if (item.outcome === "matched" || item.outcome === "changed") {
      if (
        item.currentSessions.length !== 1 ||
        item.sourceCandidates.length !== 1
      ) {
        blockers.push({
          code: "RECONCILIATION_INPUT_MISMATCH",
          itemId: item.id,
          message:
            "Matched/changed publication items must contain exactly one current session and one source candidate.",
        });
        continue;
      }
      const current = item.currentSessions[0];
      const candidate = item.sourceCandidates[0];
      const sourceValid = assertValidSourceCandidate(
        candidate,
        reconciliation,
        item.id,
        blockers,
        warnings,
      );
      if (!sourceValid) continue;
      const session = publicationSessionFromPairedItem({
        blockers,
        candidate,
        current,
        itemId: item.id,
        parseRunId: reconciliation.parseRunId,
      });
      if (session) sessions.push(session);
      operations.push({
        diffs: item.diffs,
        itemId: item.id,
        kind: item.outcome === "matched" ? "unchanged" : "update",
        sessionId: current.sessionId,
        sourceCandidateId: candidate.candidateId,
        stableSessionKey: current.stableSessionKey,
      });
      continue;
    }

    if (item.outcome === "source_only") {
      if (
        item.sourceCandidates.length !== 1 ||
        item.currentSessions.length !== 0
      ) {
        blockers.push({
          code: "RECONCILIATION_INPUT_MISMATCH",
          itemId: item.id,
          message:
            "Source-only publication items must contain exactly one source candidate and no current session.",
        });
        continue;
      }
      const candidate = item.sourceCandidates[0];
      const sourceValid = assertValidSourceCandidate(
        candidate,
        reconciliation,
        item.id,
        blockers,
        warnings,
      );
      if (!sourceValid) continue;
      const session = publicationSessionFromSourceOnly({
        blockers,
        candidate,
        cohort: result.cohort,
        itemId: item.id,
        parseRunId: reconciliation.parseRunId,
        sourceKey: result.binding.sourceKey,
      });
      if (session) {
        if (existingStableKeys.has(session.stableSessionKey)) {
          blockers.push({
            code: "IDENTITY_COLLISION",
            itemId: item.id,
            message: `Deterministic source-only stable key ${session.stableSessionKey} collides with an existing logical session.`,
          });
        }
        sessions.push(session);
        operations.push({
          diffs: [],
          itemId: item.id,
          kind: "add",
          sessionId: null,
          sourceCandidateId: candidate.candidateId,
          stableSessionKey: session.stableSessionKey,
        });
      }
      continue;
    }

    if (item.outcome === "current_only") {
      if (
        item.currentSessions.length !== 1 ||
        item.sourceCandidates.length !== 0
      ) {
        blockers.push({
          code: "RECONCILIATION_INPUT_MISMATCH",
          itemId: item.id,
          message:
            "Current-only publication items must contain exactly one current session and no source candidate.",
        });
        continue;
      }
      const current = item.currentSessions[0];
      removalSessionIds.push(current.sessionId);
      operations.push({
        diffs: [],
        itemId: item.id,
        kind: "remove",
        sessionId: current.sessionId,
        sourceCandidateId: null,
        stableSessionKey: current.stableSessionKey,
      });
    }
  }

  const currentSessionCount = result.invariants.currentSessionCount;
  const removalCount = removalSessionIds.length;
  if (removalCount > SOURCE_PUBLICATION_POLICY.maxRemovalCount) {
    blockers.push({
      code: "BLAST_RADIUS_REMOVAL_COUNT",
      message: `Plan proposes ${removalCount} removals; CS.1 canary policy allows at most ${SOURCE_PUBLICATION_POLICY.maxRemovalCount} explicit removals in one publication.`,
    });
  }
  if (
    currentSessionCount > 0 &&
    removalCount / currentSessionCount >
      SOURCE_PUBLICATION_POLICY.maxRemovalRatio
  ) {
    blockers.push({
      code: "BLAST_RADIUS_REMOVAL_RATIO",
      message: `Plan would remove ${removalCount}/${currentSessionCount} current sessions, exceeding the CS.1 canary maximum removal ratio of ${Math.round(SOURCE_PUBLICATION_POLICY.maxRemovalRatio * 100)}%.`,
    });
  }

  const orderedSessions = sessions.sort((left, right) =>
    sessionSortKey(left).localeCompare(sessionSortKey(right)),
  );
  validateFinalSessions(orderedSessions, blockers);
  const orderedOperations = operations.sort((left, right) =>
    operationSortKey(left).localeCompare(operationSortKey(right)),
  );
  const orderedRemovalIds = [...removalSessionIds].sort();
  const summary = {
    additions: orderedOperations.filter((entry) => entry.kind === "add").length,
    blockers: blockers.length,
    removals: orderedOperations.filter((entry) => entry.kind === "remove")
      .length,
    unchanged: orderedOperations.filter((entry) => entry.kind === "unchanged")
      .length,
    updates: orderedOperations.filter((entry) => entry.kind === "update")
      .length,
    warnings: warnings.length,
  };

  const withoutHash: Omit<SourcePublicationPlan, "planHash"> = {
    blockers,
    cohort: result.cohort,
    operations: orderedOperations,
    parseRunId: reconciliation.parseRunId,
    policy: SOURCE_PUBLICATION_POLICY,
    previousPublishedVersionId: result.publishedVersionId,
    reconciliationId: reconciliation.id,
    reconciliationResultHash: reconciliation.resultHash,
    removalSessionIds: orderedRemovalIds,
    sessions: orderedSessions,
    sourceSnapshotId: result.sourceSnapshotId,
    summary,
    timetableId: result.timetableId,
    warnings,
  };

  return {
    ...withoutHash,
    planHash: hashCanonicalJson(buildPlanPayload(withoutHash)),
  };
}

export function sourcePublicationPlanPayload(plan: SourcePublicationPlan) {
  return buildPlanPayload(plan);
}
