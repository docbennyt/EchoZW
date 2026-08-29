import {
  HIT_MASTER_PARSER_VERSION,
  HitParserError,
  parseHitSistMasterSnapshot,
} from "../src/domain/hitMasterSnapshotParser.js";
import {
  loadLatestRelaySnapshotForParsing,
  persistSourceSnapshotParseFailure,
  persistSourceSnapshotParseRun,
} from "./sourceSnapshotParseRepository.js";

async function main() {
  const sourceKey = process.argv[2]?.trim();
  if (!sourceKey) {
    throw new Error("Usage: npm run source:parse -- <source-key>");
  }

  const snapshot = await loadLatestRelaySnapshotForParsing(
    sourceKey,
    process.env,
  );
  if (!snapshot) {
    throw new Error(`No relay snapshot found for source ${sourceKey}.`);
  }

  try {
    const parserResult = parseHitSistMasterSnapshot({
      contentHash: snapshot.contentHash,
      payload: snapshot.payload,
      sourceKey: snapshot.sourceKey,
    });
    const persisted = await persistSourceSnapshotParseRun(
      {
        parserResult,
        snapshot,
      },
      process.env,
    );

    const blockingWarnings = parserResult.sessionCandidates.filter(
      (candidate) => candidate.reviewStatus === "invalid",
    );
    const slashResolvedExamples = parserResult.sessionCandidates
      .filter(
        (candidate) =>
          candidate.courseExpressionRaw.includes("/") &&
          candidate.courseCodeResolved,
      )
      .slice(0, 5)
      .map((candidate) => ({
        cohort: candidate.cohortCode,
        courseExpressionRaw: candidate.courseExpressionRaw,
        courseResolved: candidate.courseCodeResolved,
        source: {
          columnIndex: candidate.provenance.columnIndex,
          rowIndex: candidate.provenance.rowIndex,
          tableIndex: candidate.provenance.tableIndex,
        },
        weekday: candidate.weekdayRaw,
      }));

    console.log(
      JSON.stringify(
        {
          blockingWarnings: blockingWarnings.map((candidate) => ({
            cohort: candidate.cohortCode,
            source: {
              columnIndex: candidate.provenance.columnIndex,
              rowIndex: candidate.provenance.rowIndex,
              tableIndex: candidate.provenance.tableIndex,
            },
            warnings: candidate.warnings,
          })),
          byCohort: parserResult.summary.cohortCounts,
          masterTable: parserResult.masterTable,
          parseRun: {
            id: persisted.parseRun.id,
            persistence: persisted.persistence,
            status: persisted.parseRun.status,
          },
          parserVersion: parserResult.parserVersion,
          referenceTables: parserResult.referenceTables,
          result: {
            cohortMarkers: parserResult.invariants.recognizedCohortMarkers,
            ignored: parserResult.summary.ignoredCount,
            invalid: parserResult.summary.invalidCount,
            noSilentLoss: parserResult.invariants.noSilentLoss,
            sessionCandidates: parserResult.sessionCandidates.length,
            valid: parserResult.summary.validCount,
            warnings: parserResult.summary.warningCount,
          },
          slashResolvedExamples,
          snapshot: {
            acceptedAt: snapshot.acceptedAt,
            id: snapshot.snapshotId,
            processingStatusBefore: snapshot.processingStatus,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof HitParserError) {
      await persistSourceSnapshotParseFailure(
        {
          failureCode: error.code,
          failureMetadata: error.metadata,
          parserVersion: HIT_MASTER_PARSER_VERSION,
          snapshot,
        },
        process.env,
      );
      console.error(
        JSON.stringify(
          {
            error: {
              code: error.code,
              message: error.message,
              metadata: error.metadata,
            },
            parserVersion: HIT_MASTER_PARSER_VERSION,
            snapshot: snapshot.snapshotId,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: {
          code: "UNHANDLED_PARSE_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
