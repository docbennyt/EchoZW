import { describe, expect, it } from "vitest";

import {
  decideHumanCorrectionReplacement,
  reconcileSourceCandidatesToPublishedTimetable,
  type ReconciliationBinding,
  type ReconciliationCurrentSession,
  type ReconciliationSourceCandidate,
} from "../server/sourceReconciliation";

const binding: ReconciliationBinding = {
  sourceCohortCode: "CS.1",
  sourceKey: "hit-sist-master-sem1-2026",
  targetAcademicPeriodName: "August Semester 2026",
  targetClassGroupLabel: "1.1",
  targetPublicSlug: "hit-ics-1-1-august-semester-2026",
};

function createSourceCandidate(
  overrides: Partial<ReconciliationSourceCandidate> = {},
): ReconciliationSourceCandidate {
  return {
    candidateId: "source-1",
    cohortCode: "CS.1",
    courseCode: "ICS1101",
    courseExpressionRaw: "ICS1101",
    courseName: "Introduction to Computer Science",
    endTime: "12:15:00",
    lecturer: "Dr Ncube",
    parseWarnings: [],
    parserProvenance: {
      columnIndex: 2,
      rawCourse: "ICS1101",
      rawText: "CS.1 ICS1101 - N112 LAB",
      rawTime: "10:15 - 12:15",
      rawVenue: "N112 LAB",
      rawWeekday: "TUESDAY",
      rowIndex: 3,
      sourceCell: "CS.1 ICS1101 - N112 LAB",
      tableIndex: 0,
      tabId: "tab-1",
      tabTitle: "Semester 1",
    },
    reviewStatus: "valid",
    snapshotId: "snapshot-1",
    parseRunId: "parse-run-1",
    parserVersion: "hit-sist-google-docs-v1",
    sourceCandidateKey: "0:3:2:CS.1:ICS1101:10:15:00:12:15:00",
    sourceKey: "hit-sist-master-sem1-2026",
    startTime: "10:15:00",
    venue: "N112 LAB",
    weekday: 2,
    ...overrides,
  };
}

function createCurrentSession(
  overrides: Partial<ReconciliationCurrentSession> = {},
): ReconciliationCurrentSession {
  return {
    courseCode: "ICS1101",
    courseName: "Introduction to Computer Science",
    endTime: "12:15:00",
    lecturer: "Dr Ncube",
    notes: null,
    publishedVersionId: "version-1",
    sessionId: "session-1",
    sessionType: null,
    stableSessionKey: "ics1101__2__10:15:00__12:15:00__session",
    startTime: "10:15:00",
    timetableId: "timetable-1",
    venue: "N112 LAB",
    weekday: 2,
    ...overrides,
  };
}

function reconcile(input?: {
  sourceCandidates?: ReconciliationSourceCandidate[];
  currentSessions?: ReconciliationCurrentSession[];
}) {
  return reconcileSourceCandidatesToPublishedTimetable({
    binding,
    cohort: "CS.1",
    currentSessions: input?.currentSessions ?? [createCurrentSession()],
    publishedVersionId: "version-1",
    sourceCandidates: input?.sourceCandidates ?? [createSourceCandidate()],
    sourceSnapshotId: "snapshot-1",
    timetableId: "timetable-1",
  });
}

describe("source reconciliation", () => {
  it("matches identical course, weekday, and time exactly", () => {
    const result = reconcile();

    expect(result.summary).toEqual({
      ambiguous: 0,
      changed: 0,
      currentOnly: 0,
      matched: 1,
      sourceOnly: 0,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      outcome: "matched",
      matchStrategy: "exact_course_day_time",
    });
    expect(result.items[0].sourceCandidates[0].candidateId).toBe("source-1");
    expect(result.items[0].currentSessions[0].sessionId).toBe("session-1");
  });

  it("marks a venue change as changed while preserving both values", () => {
    const result = reconcile({
      currentSessions: [createCurrentSession({ venue: "N110" })],
    });

    expect(result.summary.changed).toBe(1);
    expect(result.items[0]).toMatchObject({
      outcome: "changed",
      matchStrategy: "exact_course_day_time",
    });
    expect(result.items[0].diffs).toContainEqual({
      current: "N110",
      field: "venue",
      source: "N112 LAB",
    });
  });

  it("marks a lecturer change as changed", () => {
    const result = reconcile({
      currentSessions: [createCurrentSession({ lecturer: "Prof Moyo" })],
    });

    expect(result.summary.changed).toBe(1);
    expect(result.items[0].diffs).toContainEqual({
      current: "Prof Moyo",
      field: "lecturer",
      source: "Dr Ncube",
    });
  });

  it("supports a unique modest time shift deterministically", () => {
    const result = reconcile({
      currentSessions: [
        createCurrentSession({
          endTime: "12:30:00",
          sessionId: "session-shifted",
          stableSessionKey: "ics1101__2__10:30:00__12:30:00__session",
          startTime: "10:30:00",
        }),
      ],
    });

    expect(result.summary.changed).toBe(1);
    expect(result.items[0]).toMatchObject({
      outcome: "changed",
      matchStrategy: "unique_course_day_plausible_shift",
    });
    expect(result.items[0].diffs).toEqual(
      expect.arrayContaining([
        { current: "10:30:00", field: "startTime", source: "10:15:00" },
        { current: "12:30:00", field: "endTime", source: "12:15:00" },
      ]),
    );
  });

  it("emits source-only items when no current session matches", () => {
    const result = reconcile({
      currentSessions: [],
    });

    expect(result.summary.sourceOnly).toBe(1);
    expect(result.items[0]).toMatchObject({
      currentSessions: [],
      outcome: "source_only",
    });
  });

  it("emits current-only items when no source candidate matches", () => {
    const result = reconcile({
      sourceCandidates: [],
    });

    expect(result.summary.currentOnly).toBe(1);
    expect(result.items[0]).toMatchObject({
      currentSessions: [expect.objectContaining({ sessionId: "session-1" })],
      outcome: "current_only",
      sourceCandidates: [],
    });
  });

  it("marks one-to-many same-course same-day leftovers as ambiguous", () => {
    const result = reconcile({
      currentSessions: [
        createCurrentSession({
          endTime: "10:00:00",
          sessionId: "session-a",
          stableSessionKey: "ics1101__2__08:00:00__10:00:00__session",
          startTime: "08:00:00",
        }),
        createCurrentSession({
          endTime: "14:15:00",
          sessionId: "session-b",
          stableSessionKey: "ics1101__2__12:15:00__14:15:00__session",
          startTime: "12:15:00",
        }),
      ],
    });

    expect(result.summary.ambiguous).toBe(1);
    expect(result.items[0]).toMatchObject({
      outcome: "ambiguous",
      sourceCandidates: [expect.objectContaining({ candidateId: "source-1" })],
    });
    expect(
      result.items[0].currentSessions.map((session) => session.sessionId),
    ).toEqual(["session-a", "session-b"]);
  });

  it("marks many-to-one same-course same-day leftovers as ambiguous", () => {
    const result = reconcile({
      sourceCandidates: [
        createSourceCandidate({
          candidateId: "source-a",
          endTime: "10:00:00",
          sourceCandidateKey: "0:1:1:CS.1:ICS1101:08:00:00:10:00:00",
          startTime: "08:00:00",
        }),
        createSourceCandidate({
          candidateId: "source-b",
          endTime: "14:15:00",
          sourceCandidateKey: "0:5:1:CS.1:ICS1101:12:15:00:14:15:00",
          startTime: "12:15:00",
        }),
      ],
    });

    expect(result.summary.ambiguous).toBe(1);
    expect(result.items[0]).toMatchObject({
      currentSessions: [expect.objectContaining({ sessionId: "session-1" })],
      outcome: "ambiguous",
    });
    expect(
      result.items[0].sourceCandidates.map(
        (candidate) => candidate.candidateId,
      ),
    ).toEqual(["source-a", "source-b"]);
  });

  it("keeps duplicate evidence visible instead of silently pairing one duplicate away", () => {
    const result = reconcile({
      sourceCandidates: [
        createSourceCandidate({ candidateId: "source-a" }),
        createSourceCandidate({ candidateId: "source-b" }),
      ],
    });

    expect(result.summary.ambiguous).toBe(1);
    expect(result.summary.matched).toBe(0);
    expect(
      result.items[0].sourceCandidates.map(
        (candidate) => candidate.candidateId,
      ),
    ).toEqual(["source-a", "source-b"]);
  });

  it("produces deterministic ordering and ids for identical inputs", () => {
    const sourceCandidates = [
      createSourceCandidate({
        candidateId: "source-z",
        courseCode: "ICS1104",
        courseExpressionRaw: "ICS1104",
        courseName: "Discrete Structures",
        endTime: "12:15:00",
        sourceCandidateKey: "0:4:3:CS.1:ICS1104:10:15:00:12:15:00",
        startTime: "10:15:00",
        weekday: 3,
      }),
      createSourceCandidate({
        candidateId: "source-a",
        endTime: "10:00:00",
        sourceCandidateKey: "0:1:1:CS.1:HIT1101:08:00:00:10:00:00",
        courseCode: "HIT1101",
        courseExpressionRaw: "HIT1101",
        courseName: "Communication Skills",
        startTime: "08:00:00",
        venue: "E/HALL",
        weekday: 1,
      }),
    ];
    const currentSessions = [
      createCurrentSession({
        courseCode: "ICS1104",
        courseName: "Discrete Structures",
        endTime: "12:15:00",
        sessionId: "session-z",
        stableSessionKey: "ics1104__3__10:15:00__12:15:00__session",
        startTime: "10:15:00",
        weekday: 3,
      }),
      createCurrentSession({
        courseCode: "HIT1101",
        courseName: "Communication Skills",
        endTime: "10:00:00",
        sessionId: "session-a",
        stableSessionKey: "hit1101__1__08:00:00__10:00:00__session",
        startTime: "08:00:00",
        venue: "E/HALL",
        weekday: 1,
      }),
    ];

    const first = reconcile({ currentSessions, sourceCandidates });
    const second = reconcile({ currentSessions, sourceCandidates });

    expect(first).toEqual(second);
    expect(first.items.map((item) => item.id)).toEqual(
      first.items
        .map((item) => item.id)
        .slice()
        .sort(),
    );
  });

  it("keeps the conservation invariant across all outcomes", () => {
    const result = reconcile({
      sourceCandidates: [
        createSourceCandidate({ candidateId: "source-match" }),
        createSourceCandidate({
          candidateId: "source-only",
          courseCode: "ICS1104",
          courseExpressionRaw: "ICS1104",
          courseName: "Discrete Structures",
          sourceCandidateKey: "0:4:3:CS.1:ICS1104:10:15:00:12:15:00",
          weekday: 3,
        }),
      ],
      currentSessions: [
        createCurrentSession({ sessionId: "session-match" }),
        createCurrentSession({
          courseCode: "ICS1105",
          courseName: "Programming Lab",
          sessionId: "session-only",
          stableSessionKey: "ics1105__4__08:00:00__10:00:00__session",
          weekday: 4,
        }),
      ],
    });

    expect(result.invariants.noSilentLoss).toBe(true);
    expect(result.invariants.sourceCandidatesCovered).toBe(2);
    expect(result.invariants.currentSessionsCovered).toBe(2);
  });

  it("preserves provenance for both source and current sides", () => {
    const result = reconcile();
    const item = result.items[0];

    expect(item.sourceCandidates[0]).toMatchObject({
      candidateId: "source-1",
      parseRunId: "parse-run-1",
      snapshotId: "snapshot-1",
      sourceKey: "hit-sist-master-sem1-2026",
    });
    expect(item.currentSessions[0]).toMatchObject({
      publishedVersionId: "version-1",
      sessionId: "session-1",
      stableSessionKey: "ics1101__2__10:15:00__12:15:00__session",
      timetableId: "timetable-1",
    });
  });
});

describe("human correction replacement safety", () => {
  it("keeps pinned OS corrections effective despite later source disagreement", () => {
    const decision = decideHumanCorrectionReplacement({
      correction: {
        correctionId: "pinned-os",
        sourceMayReplace: false,
      },
      item: {
        id: "diff-1",
        outcome: "changed",
        matchStrategy: "exact_course_day_time",
        diffs: [{ field: "venue", current: "N110", source: "N109" }],
        currentSessions: [
          createCurrentSession({
            courseCode: "ICS1102",
            courseName: "Operating Systems",
            stableSessionKey: "ics1102-tue-1400",
            venue: "N110",
          }),
        ],
        sourceCandidates: [
          createSourceCandidate({
            courseCode: "ICS1102",
            courseName: "Operating Systems",
            venue: "N109",
          }),
        ],
      },
    });

    expect(decision).toEqual({
      correctionId: "pinned-os",
      maySupersede: false,
      reason: "PINNED",
    });
  });

  it("does not let ambiguous source output silently overwrite human corrections", () => {
    const decision = decideHumanCorrectionReplacement({
      correction: {
        correctionId: "replaceable-but-ambiguous",
        sourceMayReplace: true,
      },
      item: {
        id: "ambiguous-1",
        outcome: "ambiguous",
        matchStrategy: "ambiguous_group",
        diffs: [],
        currentSessions: [createCurrentSession()],
        sourceCandidates: [
          createSourceCandidate(),
          createSourceCandidate({ candidateId: "source-2" }),
        ],
      },
    });

    expect(decision.maySupersede).toBe(false);
    expect(decision.reason).toBe("AMBIGUOUS_SOURCE");
  });
});
