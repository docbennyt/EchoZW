import { describe, expect, it } from "vitest";

import {
  reconcileSourceCandidatesToPublishedTimetable,
  type ReconciliationBinding,
  type ReconciliationCurrentSession,
  type ReconciliationSourceCandidate,
} from "../server/sourceReconciliation";
import {
  buildSourcePublicationPlan,
  SOURCE_PUBLICATION_POLICY,
  type PersistedVerifiedReconciliation,
} from "../server/sourcePublication";

const binding: ReconciliationBinding = {
  sourceCohortCode: "CS.1",
  sourceKey: "hit-sist-master-sem1-2026",
  targetAcademicPeriodName: "August Semester 2026",
  targetClassGroupLabel: "1.1",
  targetPublicSlug: "hit-ics-1-1-august-semester-2026",
};

function sourceCandidate(
  overrides: Partial<ReconciliationSourceCandidate> = {},
): ReconciliationSourceCandidate {
  return {
    candidateId: "source-1",
    cohortCode: "CS.1",
    courseCode: "ICS1101",
    courseExpressionRaw: "ICS1101",
    courseName: "Principles of Programming Languages",
    endTime: "10:00:00",
    lecturer: "Dr Ncube",
    parseRunId: "parse-1",
    parserProvenance: {
      columnIndex: 1,
      rawCourse: "ICS1101",
      rawText: "CS.1 ICS1101 - N112",
      rawTime: "08:00 - 10:00",
      rawVenue: "N112",
      rawWeekday: "TUESDAY",
      rowIndex: 2,
      sourceCell: "CS.1 ICS1101 - N112",
      tableIndex: 0,
      tabId: "tab-1",
      tabTitle: "Semester 1",
    },
    parserVersion: "hit-sist-google-docs-v1",
    parseWarnings: [],
    reviewStatus: "valid",
    snapshotId: "snapshot-1",
    sourceCandidateKey: "candidate-key-1",
    sourceKey: binding.sourceKey,
    startTime: "08:00:00",
    venue: "N112",
    weekday: 2,
    ...overrides,
  };
}

function currentSession(
  overrides: Partial<ReconciliationCurrentSession> = {},
): ReconciliationCurrentSession {
  return {
    courseCode: "ICS1101",
    courseName: "Principles of Programming Languages",
    endTime: "10:00:00",
    lecturer: "Dr Ncube",
    notes: "Keep current note",
    publishedVersionId: "published-1",
    sessionId: "session-1",
    sessionType: "Lecture",
    stableSessionKey: "ics1101__2__08:00:00__10:00:00__lecture",
    startTime: "08:00:00",
    timetableId: "timetable-1",
    venue: "N112",
    weekday: 2,
    ...overrides,
  };
}

function artifact(input: {
  currentSessions: ReconciliationCurrentSession[];
  sourceCandidates: ReconciliationSourceCandidate[];
}): PersistedVerifiedReconciliation {
  const result = reconcileSourceCandidatesToPublishedTimetable({
    binding,
    cohort: "CS.1",
    currentSessions: input.currentSessions,
    publishedVersionId: "published-1",
    sourceCandidates: input.sourceCandidates,
    sourceSnapshotId: "snapshot-1",
    timetableId: "timetable-1",
  });
  return {
    id: "reconciliation-1",
    parseRunId: "parse-1",
    parserVersion: "hit-sist-google-docs-v1",
    result,
    resultHash: "verified-result-hash",
    verifiedAt: "2026-09-07T10:00:00.000Z",
  };
}

function sessionPair(index: number) {
  const weekday = index + 1;
  const courseCode = `ICS11${String(index).padStart(2, "0")}`;
  return {
    current: currentSession({
      courseCode,
      courseName: `Course ${index}`,
      sessionId: `session-${index}`,
      stableSessionKey: `${courseCode.toLowerCase()}__${weekday}__08:00:00__10:00:00__lecture`,
      weekday,
    }),
    source: sourceCandidate({
      candidateId: `source-${index}`,
      courseCode,
      courseExpressionRaw: courseCode,
      courseName: `Course ${index}`,
      sourceCandidateKey: `candidate-key-${index}`,
      weekday,
    }),
  };
}

describe("guarded source publication planning", () => {
  it("preserves stable identity for matched sessions", () => {
    const current = currentSession();
    const plan = buildSourcePublicationPlan(
      artifact({ currentSessions: [current], sourceCandidates: [sourceCandidate()] }),
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.summary).toMatchObject({ unchanged: 1, updates: 0 });
    expect(plan.sessions[0].stableSessionKey).toBe(current.stableSessionKey);
    expect(plan.operations[0]).toMatchObject({
      kind: "unchanged",
      stableSessionKey: current.stableSessionKey,
    });
  });

  it("updates source content while preserving stable identity for an unambiguous changed match", () => {
    const current = currentSession({
      endTime: "10:15:00",
      startTime: "08:15:00",
      venue: "N110",
    });
    const plan = buildSourcePublicationPlan(
      artifact({ currentSessions: [current], sourceCandidates: [sourceCandidate()] }),
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.summary.updates).toBe(1);
    expect(plan.sessions[0]).toMatchObject({
      endTime: "10:00:00",
      stableSessionKey: current.stableSessionKey,
      startTime: "08:00:00",
      venue: "N112",
    });
  });

  it("creates deterministic auditable stable identity for a valid source-only session", () => {
    const input = artifact({
      currentSessions: [],
      sourceCandidates: [sourceCandidate()],
    });
    const first = buildSourcePublicationPlan(input);
    const second = buildSourcePublicationPlan(input);

    expect(first.blockers).toEqual([]);
    expect(first.summary.additions).toBe(1);
    expect(first.sessions[0].stableSessionKey).toMatch(/^source_[a-f0-9]{24}$/);
    expect(first.sessions[0].stableSessionKey).toBe(
      second.sessions[0].stableSessionKey,
    );
    expect(first.planHash).toBe(second.planHash);
  });

  it("makes a small current-only removal explicit without silently applying it", () => {
    const pairs = [1, 2, 3, 4, 5].map(sessionPair);
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: pairs.map((pair) => pair.current),
        sourceCandidates: pairs.slice(0, 4).map((pair) => pair.source),
      }),
    );

    expect(SOURCE_PUBLICATION_POLICY.maxRemovalRatio).toBe(0.2);
    expect(plan.blockers).toEqual([]);
    expect(plan.summary.removals).toBe(1);
    expect(plan.removalSessionIds).toEqual(["session-5"]);
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        kind: "remove",
        sessionId: "session-5",
      }),
    );
    expect(plan.sessions).toHaveLength(4);
  });

  it("blocks any ambiguous reconciliation item", () => {
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [currentSession()],
        sourceCandidates: [
          sourceCandidate({ candidateId: "source-a" }),
          sourceCandidate({
            candidateId: "source-b",
            sourceCandidateKey: "candidate-key-b",
          }),
        ],
      }),
    );

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_RECONCILIATION" }),
    );
  });

  it("blocks invalid or warning-status source candidates from automatic publication", () => {
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [currentSession()],
        sourceCandidates: [sourceCandidate({ reviewStatus: "warning" })],
      }),
    );

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "INVALID_SOURCE_CANDIDATE" }),
    );
  });

  it("blocks a suspicious current-only removal ratio", () => {
    const first = sessionPair(1);
    const second = sessionPair(2);
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [first.current, second.current],
        sourceCandidates: [first.source],
      }),
    );

    expect(plan.summary.removals).toBe(1);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "BLAST_RADIUS_REMOVAL_RATIO" }),
    );
  });

  it("blocks more than three removals even for a large canary timetable", () => {
    const pairs = Array.from({ length: 20 }, (_, index) =>
      sessionPair((index % 7) + 1),
    ).map((pair, index) => ({
      current: {
        ...pair.current,
        courseCode: `ICS${1200 + index}`,
        courseName: `Course ${index}`,
        sessionId: `large-session-${index}`,
        stableSessionKey: `large-${index}`,
        startTime: `${String(8 + Math.floor(index / 7) * 2).padStart(2, "0")}:00:00`,
        endTime: `${String(10 + Math.floor(index / 7) * 2).padStart(2, "0")}:00:00`,
      },
      source: {
        ...pair.source,
        candidateId: `large-source-${index}`,
        courseCode: `ICS${1200 + index}`,
        courseExpressionRaw: `ICS${1200 + index}`,
        courseName: `Course ${index}`,
        sourceCandidateKey: `large-candidate-${index}`,
        startTime: `${String(8 + Math.floor(index / 7) * 2).padStart(2, "0")}:00:00`,
        endTime: `${String(10 + Math.floor(index / 7) * 2).padStart(2, "0")}:00:00`,
      },
    }));
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: pairs.map((pair) => pair.current),
        sourceCandidates: pairs.slice(0, 16).map((pair) => pair.source),
      }),
    );

    expect(plan.summary.removals).toBe(4);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "BLAST_RADIUS_REMOVAL_COUNT" }),
    );
  });

  it("blocks duplicate logical sessions even when deterministic stable keys differ", () => {
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [],
        sourceCandidates: [
          sourceCandidate({
            candidateId: "source-a",
            sourceCandidateKey: "candidate-a",
          }),
          sourceCandidate({
            candidateId: "source-b",
            sourceCandidateKey: "candidate-b",
          }),
        ],
      }),
    );

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_LOGICAL_SESSION" }),
    );
  });

  it("blocks overlapping sessions before publication", () => {
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [],
        sourceCandidates: [
          sourceCandidate({
            candidateId: "source-a",
            sourceCandidateKey: "candidate-a",
          }),
          sourceCandidate({
            candidateId: "source-b",
            courseCode: "ICS1102",
            courseExpressionRaw: "ICS1102",
            courseName: "Operating Systems",
            endTime: "11:00:00",
            sourceCandidateKey: "candidate-b",
            startTime: "09:00:00",
          }),
        ],
      }),
    );

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "OVERLAPPING_SESSIONS" }),
    );
  });

  it("blocks source candidates that do not belong to the persisted snapshot/parse input", () => {
    const plan = buildSourcePublicationPlan(
      artifact({
        currentSessions: [currentSession()],
        sourceCandidates: [sourceCandidate({ parseRunId: "other-parse" })],
      }),
    );

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "RECONCILIATION_INPUT_MISMATCH" }),
    );
  });
});
