import { describe, expect, it, vi } from "vitest";
import {
  buildDraftSessionsForMappedCohort,
  discoverSourceCatalog,
  processSourceSnapshot,
  type SourceMappedCohort,
} from "../server/sourceProcessingService";
import type { HitParserResult } from "../src/domain/hitMasterSnapshotParser";

function parserResult(): HitParserResult {
  return {
    courseCatalog: [],
    ignoredRecords: [],
    invariants: {
      candidateLikeRecordCount: 2,
      noSilentLoss: true,
      recognizedCohortMarkers: 2,
    },
    masterTable: {
      columnCount: 3,
      rowCount: 3,
      tableIndex: 0,
      tabId: "tab-1",
      tabTitle: "Master",
      weekdayHeaders: ["Monday", "Tuesday"],
    },
    parserVersion: "hit-sist-google-docs-v1",
    referenceTables: [],
    sessionCandidates: [
      {
        confidence: 0.98,
        cohortCode: "CS.1",
        courseCodeResolved: "ICS1101",
        courseExpressionRaw: "ICS1101",
        courseName: "Programming",
        endTime: "10:00",
        id: "candidate-cs",
        lecturerNormalized: null,
        lecturerRaw: "Dr A",
        programmeCode: "CS",
        provenance: {},
        reviewStatus: "valid",
        sourceCandidateKey: "0:1:1:CS.1:ICS1101:08:00:10:00",
        startTime: "08:00",
        timeRaw: "08:00-10:00",
        warnings: [],
        venueNormalized: "N101",
        venueRaw: "N101",
        weekday: 1,
        weekdayRaw: "Monday",
      },
      {
        confidence: 0.7,
        cohortCode: "SE.1",
        courseCodeResolved: null,
        courseExpressionRaw: "Technoprenuership",
        courseName: null,
        endTime: "12:00",
        id: "candidate-se",
        lecturerNormalized: null,
        lecturerRaw: null,
        programmeCode: "SE",
        provenance: {},
        reviewStatus: "warning",
        sourceCandidateKey: "0:2:1:SE.1:Technoprenuership:10:00:12:00",
        startTime: "10:00",
        timeRaw: "10:00-12:00",
        warnings: [{ code: "COURSE_CODE_UNRESOLVED", severity: "warning" }],
        venueNormalized: null,
        venueRaw: null,
        weekday: 2,
        weekdayRaw: "Tuesday",
      },
    ],
    sourceMetadata: {},
    status: "review_required",
    summary: {},
    warnings: [],
  } as unknown as HitParserResult;
}

const seMapping: SourceMappedCohort = {
  discoveryCohortId: "discovered-se-1",
  sourceCohortCode: "SE.1",
  targetAcademicPeriodId: "period-1",
  targetCohortId: "cohort-1",
  targetProgrammeId: "programme-1",
};

describe("source processing service", () => {
  it("discovers every programme and cohort without heuristic target mapping", () => {
    expect(discoverSourceCatalog(parserResult())).toEqual({
      cohorts: [
        {
          sessionCount: 1,
          sourceCohortCode: "CS.1",
          sourceProgrammeCode: "CS",
        },
        {
          sessionCount: 1,
          sourceCohortCode: "SE.1",
          sourceProgrammeCode: "SE",
        },
      ],
      programmes: [
        {
          displayLabel: "CS",
          sessionCount: 1,
          sourceProgrammeCode: "CS",
        },
        {
          displayLabel: "SE",
          sessionCount: 1,
          sourceProgrammeCode: "SE",
        },
      ],
    });
  });

  it("builds source draft sessions without manufacturing missing course codes", () => {
    const sessions = buildDraftSessionsForMappedCohort({
      mapping: seMapping,
      parserResult: parserResult(),
      sourceKey: "hit-sist-master-sem1-2026",
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      courseCode: "Technoprenuership",
      courseName: "Technoprenuership",
      venue: null,
      lecturer: null,
    });
    expect(sessions[0].stableSessionKey).toMatch(/^source_[a-f0-9]{24}$/);
  });

  it("keeps stable identity across venue-only source changes", () => {
    const first = buildDraftSessionsForMappedCohort({
      mapping: seMapping,
      parserResult: parserResult(),
      sourceKey: "hit-sist-master-sem1-2026",
    })[0].stableSessionKey;
    const changed: HitParserResult = {
      ...parserResult(),
      sessionCandidates: parserResult().sessionCandidates.map((candidate) =>
        candidate.cohortCode === "SE.1"
          ? { ...candidate, venueRaw: "N204", venueNormalized: "N204" }
          : candidate,
      ),
    };

    expect(
      buildDraftSessionsForMappedCohort({
        mapping: seMapping,
        parserResult: changed,
        sourceKey: "hit-sist-master-sem1-2026",
      })[0].stableSessionKey,
    ).toBe(first);
  });

  it("fans out one parse to every explicitly mapped cohort and never publishes", async () => {
    const materializeDraft = vi.fn(async () => ({
      draftVersionId: "draft-1",
      reviewId: "review-1",
      sessionCount: 1,
      status: "draft_generated" as const,
      timetableId: "timetable-1",
    }));
    const summary = await processSourceSnapshot(
      "snapshot-1",
      {
        listMappedCohorts: vi.fn(async () => [
          {
            ...seMapping,
            sourceCohortCode: "CS.1",
          },
          seMapping,
        ]),
        loadSnapshot: vi.fn(async () => ({
          acceptedAt: "2026-09-01T08:00:00.000Z",
          contentHash: "hash-1",
          externalFileId: "file-1",
          observedAt: "2026-09-01T08:00:00.000Z",
          parserProfile: "hit_sist_master_v1",
          payload: {
            schemaVersion: 1 as const,
            sourceId: "hit-sist-master-sem1-2026",
            provider: "google_docs_apps_script" as const,
            fileId: "file-1",
            fileName: "fixture",
            observedAt: "2026-09-01T08:00:00.000Z",
            contentHash: "hash-1",
            tabs: [],
          },
          processingStatus: "pending_parse" as const,
          provider: "google_docs_apps_script",
          snapshotId: "snapshot-1",
          sourceId: "source-1",
          sourceKey: "hit-sist-master-sem1-2026",
        })),
        markJobCompleted: vi.fn(),
        materializeDraft,
        persistParseFailure: vi.fn(),
        persistParseRun: vi.fn(async () => ({
          parseRun: { id: "parse-run-1" },
          persistence: "created" as const,
        })),
        upsertDiscovery: vi.fn(),
      },
      {
        resolveParser: () => ({
          parse: () => parserResult(),
          parserVersion: "hit-sist-google-docs-v1",
          profile: "hit_sist_master_v1",
        }),
      },
    );

    expect(summary).toMatchObject({
      cohortsMapped: 2,
      cohortsProcessed: 2,
      draftsGenerated: 2,
    });
    expect(materializeDraft).toHaveBeenCalledTimes(2);
  });
});
