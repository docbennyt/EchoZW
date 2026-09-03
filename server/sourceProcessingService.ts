import { createHash } from "node:crypto";
import type {
  HitParsedSessionCandidate,
  HitParserResult,
} from "../src/domain/hitMasterSnapshotParser.js";
import type { RelaySnapshotForParse } from "./sourceSnapshotParseRepository.js";
import {
  HitParserError,
  resolveSourceParser,
  SourceParserRegistryError,
  type SourceParser,
  type SourceParserResult,
} from "./sourceParserRegistry.js";

export type SourceDiscoveryProgramme = {
  displayLabel: string | null;
  sessionCount: number;
  sourceProgrammeCode: string;
};

export type SourceDiscoveryCohort = {
  sessionCount: number;
  sourceCohortCode: string;
  sourceProgrammeCode: string;
};

export type SourceMappedCohort = {
  discoveryCohortId: string;
  sourceCohortCode: string;
  targetAcademicPeriodId: string;
  targetCohortId: string;
  targetProgrammeId: string;
};

export type SourceDraftSession = {
  courseCode: string;
  courseName: string;
  endTime: string;
  lecturer: string | null;
  notes: string | null;
  sourceCandidateId: string;
  sourceCandidateKey: string;
  stableSessionKey: string;
  startTime: string;
  sessionType: string | null;
  venue: string | null;
  weekday: number;
};

export type SourceProcessingRepository = {
  listMappedCohorts: (input: {
    sourceId: string;
    sourceKey: string;
  }) => Promise<SourceMappedCohort[]>;
  loadSnapshot: (snapshotId: string) => Promise<RelaySnapshotForParse>;
  markJobCompleted?: (
    snapshotId: string,
    summary: SourceProcessingSummary,
  ) => Promise<void>;
  materializeDraft: (input: {
    mapping: SourceMappedCohort;
    parseRunId: string;
    parserVersion: string;
    sessions: SourceDraftSession[];
    snapshot: RelaySnapshotForParse;
  }) => Promise<SourceDraftMaterializationResult>;
  persistParseFailure: (input: {
    failureCode: string;
    failureMetadata: Record<string, unknown>;
    parserVersion: string;
    snapshot: RelaySnapshotForParse;
  }) => Promise<void>;
  persistParseRun: (input: {
    parserResult: SourceParserResult;
    snapshot: RelaySnapshotForParse;
  }) => Promise<{
    parseRun: { id: string };
    persistence: "created" | "existing";
  }>;
  upsertDiscovery: (input: {
    cohorts: SourceDiscoveryCohort[];
    parseRunId: string;
    programmes: SourceDiscoveryProgramme[];
    sourceId: string;
  }) => Promise<void>;
};

export type SourceDraftMaterializationResult = {
  draftVersionId: string | null;
  reviewId: string | null;
  sessionCount: number;
  status: "draft_generated" | "no_actionable_sessions" | "skipped";
  timetableId: string | null;
};

export type SourceProcessingSummary = {
  cohortsDiscovered: number;
  cohortsMapped: number;
  cohortsProcessed: number;
  cohortsUnmapped: number;
  draftsGenerated: number;
  parseRunId: string;
  programmesDiscovered: number;
};

function countBy<T>(entries: T[], keyFor: (entry: T) => string) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = keyFor(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function discoverSourceCatalog(parserResult: HitParserResult): {
  cohorts: SourceDiscoveryCohort[];
  programmes: SourceDiscoveryProgramme[];
} {
  const validCandidates = parserResult.sessionCandidates.filter(
    (candidate) => candidate.reviewStatus !== "invalid",
  );
  const programmeCounts = countBy(
    validCandidates,
    (candidate) => candidate.programmeCode,
  );
  const cohortCounts = countBy(
    validCandidates,
    (candidate) => candidate.cohortCode,
  );

  return {
    cohorts: [...cohortCounts.entries()]
      .map(([sourceCohortCode, sessionCount]) => ({
        sessionCount,
        sourceCohortCode,
        sourceProgrammeCode: sourceCohortCode.split(".")[0] ?? sourceCohortCode,
      }))
      .sort((left, right) =>
        left.sourceCohortCode.localeCompare(right.sourceCohortCode),
      ),
    programmes: [...programmeCounts.entries()]
      .map(([sourceProgrammeCode, sessionCount]) => ({
        displayLabel: sourceProgrammeCode,
        sessionCount,
        sourceProgrammeCode,
      }))
      .sort((left, right) =>
        left.sourceProgrammeCode.localeCompare(right.sourceProgrammeCode),
      ),
  };
}

function stableSourceSessionKey(input: {
  candidate: HitParsedSessionCandidate;
  sourceKey: string;
}) {
  const identitySeed = [
    input.sourceKey,
    input.candidate.cohortCode,
    input.candidate.courseCodeResolved ?? input.candidate.courseExpressionRaw,
    input.candidate.weekday ?? "",
    input.candidate.startTime ?? "",
    input.candidate.endTime ?? "",
  ].join("|");
  return `source_${createHash("sha256").update(identitySeed).digest("hex").slice(0, 24)}`;
}

export function buildDraftSessionsForMappedCohort(input: {
  mapping: SourceMappedCohort;
  parserResult: HitParserResult;
  sourceKey: string;
}) {
  return input.parserResult.sessionCandidates
    .filter(
      (candidate) =>
        candidate.cohortCode === input.mapping.sourceCohortCode &&
        candidate.reviewStatus !== "invalid" &&
        candidate.weekday !== null &&
        candidate.startTime !== null &&
        candidate.endTime !== null,
    )
    .map((candidate) => ({
      courseCode:
        candidate.courseCodeResolved?.trim() ||
        candidate.courseExpressionRaw.trim(),
      courseName:
        candidate.courseName?.trim() || candidate.courseExpressionRaw.trim(),
      endTime: candidate.endTime ?? "",
      lecturer: candidate.lecturerRaw,
      notes: candidate.warnings.length
        ? `Source warnings: ${candidate.warnings
            .map((warning) => warning.code)
            .join(", ")}`
        : null,
      sessionType: null,
      sourceCandidateId: candidate.id,
      sourceCandidateKey: candidate.sourceCandidateKey,
      stableSessionKey: stableSourceSessionKey({
        candidate,
        sourceKey: input.sourceKey,
      }),
      startTime: candidate.startTime ?? "",
      venue: candidate.venueRaw,
      weekday: candidate.weekday ?? 1,
    }))
    .sort((left, right) =>
      [
        left.weekday,
        left.startTime,
        left.endTime,
        left.courseCode,
        left.sourceCandidateKey,
      ]
        .join("|")
        .localeCompare(
          [
            right.weekday,
            right.startTime,
            right.endTime,
            right.courseCode,
            right.sourceCandidateKey,
          ].join("|"),
        ),
    );
}

export async function processSourceSnapshot(
  snapshotId: string,
  repository: SourceProcessingRepository,
  deps: {
    resolveParser?: (profile: string | null | undefined) => SourceParser;
  } = {},
) {
  const snapshot = await repository.loadSnapshot(snapshotId);
  const parser = (deps.resolveParser ?? resolveSourceParser)(
    snapshot.parserProfile,
  );

  let parserResult: SourceParserResult;
  try {
    parserResult = parser.parse({
      contentHash: snapshot.contentHash,
      payload: snapshot.payload,
      sourceKey: snapshot.sourceKey,
    });
  } catch (error) {
    if (error instanceof HitParserError) {
      await repository.persistParseFailure({
        failureCode: error.code,
        failureMetadata: error.metadata,
        parserVersion: parser.parserVersion,
        snapshot,
      });
      throw error;
    }
    throw error;
  }

  const persisted = await repository.persistParseRun({
    parserResult,
    snapshot,
  });
  const discovery = discoverSourceCatalog(parserResult);
  await repository.upsertDiscovery({
    ...discovery,
    parseRunId: persisted.parseRun.id,
    sourceId: snapshot.sourceId,
  });

  const mappings = await repository.listMappedCohorts({
    sourceId: snapshot.sourceId,
    sourceKey: snapshot.sourceKey,
  });
  const materializations = [];
  for (const mapping of mappings) {
    materializations.push(
      await repository.materializeDraft({
        mapping,
        parseRunId: persisted.parseRun.id,
        parserVersion: parser.parserVersion,
        sessions: buildDraftSessionsForMappedCohort({
          mapping,
          parserResult,
          sourceKey: snapshot.sourceKey,
        }),
        snapshot,
      }),
    );
  }

  const summary: SourceProcessingSummary = {
    cohortsDiscovered: discovery.cohorts.length,
    cohortsMapped: mappings.length,
    cohortsProcessed: materializations.filter(
      (result) => result.status === "draft_generated",
    ).length,
    cohortsUnmapped: Math.max(discovery.cohorts.length - mappings.length, 0),
    draftsGenerated: materializations.filter(
      (result) => result.status === "draft_generated",
    ).length,
    parseRunId: persisted.parseRun.id,
    programmesDiscovered: discovery.programmes.length,
  };
  await repository.markJobCompleted?.(snapshotId, summary);
  return summary;
}

export function classifySourceProcessingError(error: unknown) {
  if (error instanceof SourceParserRegistryError) return error.code;
  if (error instanceof HitParserError) return error.code;
  return "SOURCE_PROCESSING_FAILED";
}
