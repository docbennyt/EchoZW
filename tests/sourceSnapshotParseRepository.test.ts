import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  loadLatestRelaySnapshotForParsing,
  persistSourceSnapshotParseRun,
} from "../server/sourceSnapshotParseRepository";

function createParserResult() {
  return {
    courseCatalog: [],
    ignoredRecords: [],
    invariants: {
      candidateLikeRecordCount: 1,
      noSilentLoss: true,
      recognizedCohortMarkers: 1,
    },
    masterTable: {
      columnCount: 6,
      rowCount: 8,
      tableIndex: 0,
      tabId: "t.0",
      tabTitle: "Tab 1",
      weekdayHeaders: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    },
    parserVersion: "hit-sist-google-docs-v1" as const,
    referenceTables: [],
    sessionCandidates: [],
    sourceMetadata: {
      contentHash: "fixture-hash",
      externalFileId: "fixture-file",
      fileName: "Fixture Source",
      observedAt: "2026-08-23T18:28:34.478Z",
      sourceKey: "hit-sist-master-sem1-2026",
      tabCount: 1,
      tableCount: 5,
    },
    status: "review_required" as const,
    summary: {
      cohortCounts: { "CS.1": 1 },
      ignoredCount: 0,
      invalidCount: 0,
      programmeCounts: { CS: 1, ISA: 0, IT: 0, SE: 0 },
      validCount: 0,
      warningCount: 1,
    },
    warnings: [],
  };
}

function createSnapshot() {
  return {
    acceptedAt: "2026-08-23T18:28:36.084Z",
    contentHash: "fixture-hash",
    externalFileId: "fixture-file",
    observedAt: "2026-08-23T18:28:34.478Z",
    payload: {
      schemaVersion: 1 as const,
      sourceId: "hit-sist-master-sem1-2026",
      provider: "google_docs_apps_script" as const,
      fileId: "fixture-file",
      fileName: "Fixture Source",
      observedAt: "2026-08-23T18:28:34.478Z",
      contentHash: "fixture-hash",
      tabs: [{ id: "t.0", title: "Tab 1", text: "", tables: [] }],
    },
    processingStatus: "pending_parse" as const,
    provider: "google_docs_apps_script" as const,
    snapshotId: "snapshot-1",
    sourceId: "source-1",
    sourceKey: "hit-sist-master-sem1-2026",
    parserProfile: "hit_sist_master_v1",
  };
}

function createParseRunClient(existingRun: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  adminClientMocks.createSupabaseAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "timetable_source_parse_runs") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: existingRun,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }

      if (table === "timetable_source_snapshots") {
        return {
          update: vi.fn((payload) => {
            updates.push(payload);
            return {
              eq: vi.fn(async () => ({ error: null })),
            };
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  });

  return { updates };
}

describe("source snapshot parse repository", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("loads the latest relay snapshot for parser execution", async () => {
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "timetable_sources") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: "source-1",
                    source_key: "hit-sist-master-sem1-2026",
                    provider: "google_docs_apps_script",
                    external_file_id: "fixture-file",
                  },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === "timetable_source_snapshots") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: {
                        id: "snapshot-1",
                        source_id: "source-1",
                        provider: "google_docs_apps_script",
                        external_file_id: "fixture-file",
                        observed_at: "2026-08-23T18:28:34.478Z",
                        accepted_at: "2026-08-23T18:28:36.084Z",
                        content_hash: "fixture-hash",
                        raw_payload: {
                          schemaVersion: 1,
                          sourceId: "hit-sist-master-sem1-2026",
                          provider: "google_docs_apps_script",
                          fileId: "fixture-file",
                          fileName: "Fixture Source",
                          observedAt: "2026-08-23T18:28:34.478Z",
                          contentHash: "fixture-hash",
                          tabs: [
                            { id: "t.0", title: "Tab 1", text: "", tables: [] },
                          ],
                        },
                        processing_status: "pending_parse",
                      },
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    await expect(
      loadLatestRelaySnapshotForParsing("hit-sist-master-sem1-2026"),
    ).resolves.toMatchObject({
      snapshotId: "snapshot-1",
      sourceId: "source-1",
      sourceKey: "hit-sist-master-sem1-2026",
      processingStatus: "pending_parse",
    });
  });

  it("treats an existing matching parse run as idempotent persistence", async () => {
    const parserResult = createParserResult();
    const { updates } = createParseRunClient({
      id: "parse-run-1",
      snapshot_id: "snapshot-1",
      parser_version: "hit-sist-google-docs-v1",
      status: "review_required",
      started_at: "2026-08-23T18:40:00.000Z",
      completed_at: "2026-08-23T18:40:00.000Z",
      summary: parserResult.summary,
      result_payload: parserResult,
      failure_code: null,
      failure_metadata: {},
    });

    const result = await persistSourceSnapshotParseRun({
      parserResult,
      snapshot: createSnapshot(),
    });

    expect(result.persistence).toBe("existing");
    expect(result.parseRun.id).toBe("parse-run-1");
    expect(updates).toEqual([
      {
        failure_code: null,
        failure_metadata: {},
        processing_status: "parsed",
      },
    ]);
  });

  it("reuses an existing parse run when top-level object keys are reordered", async () => {
    const parserResult = {
      ...createParserResult(),
      parseCounts: {
        valid: 158,
        warning: 11,
      },
    };
    const { updates } = createParseRunClient({
      id: "parse-run-1",
      snapshot_id: "snapshot-1",
      parser_version: "hit-sist-google-docs-v1",
      status: "review_required",
      started_at: "2026-08-23T18:40:00.000Z",
      completed_at: "2026-08-23T18:40:00.000Z",
      summary: parserResult.summary,
      result_payload: {
        ...parserResult,
        parseCounts: {
          warning: 11,
          valid: 158,
        },
      },
      failure_code: null,
      failure_metadata: {},
    });

    const result = await persistSourceSnapshotParseRun({
      parserResult,
      snapshot: createSnapshot(),
    });

    expect(result.persistence).toBe("existing");
    expect(updates).toHaveLength(1);
  });

  it("reuses an existing parse run when nested object keys are reordered", async () => {
    const parserResult = createParserResult();
    const persistedSummary = {
      validCount: 0,
      warningCount: 1,
      programmeCounts: { SE: 0, IT: 0, ISA: 0, CS: 1 },
      ignoredCount: 0,
      invalidCount: 0,
      cohortCounts: { "CS.1": 1 },
    };
    createParseRunClient({
      id: "parse-run-1",
      snapshot_id: "snapshot-1",
      parser_version: "hit-sist-google-docs-v1",
      status: "review_required",
      started_at: "2026-08-23T18:40:00.000Z",
      completed_at: "2026-08-23T18:40:00.000Z",
      summary: persistedSummary,
      result_payload: {
        ...parserResult,
        invariants: {
          recognizedCohortMarkers: 1,
          noSilentLoss: true,
          candidateLikeRecordCount: 1,
        },
        summary: persistedSummary,
      },
      failure_code: null,
      failure_metadata: {},
    });

    const result = await persistSourceSnapshotParseRun({
      parserResult,
      snapshot: createSnapshot(),
    });

    expect(result.persistence).toBe("existing");
  });

  it("detects array order changes as a semantic conflict", async () => {
    const parserResult = createParserResult();
    createParseRunClient({
      id: "parse-run-1",
      snapshot_id: "snapshot-1",
      parser_version: "hit-sist-google-docs-v1",
      status: "review_required",
      started_at: "2026-08-23T18:40:00.000Z",
      completed_at: "2026-08-23T18:40:00.000Z",
      summary: parserResult.summary,
      result_payload: {
        ...parserResult,
        warnings: [
          { code: "second", detail: "second warning" },
          { code: "first", detail: "first warning" },
        ],
      },
      failure_code: null,
      failure_metadata: {},
    });

    await expect(
      persistSourceSnapshotParseRun({
        parserResult: {
          ...parserResult,
          warnings: [
            { code: "first", detail: "first warning" },
            { code: "second", detail: "second warning" },
          ],
        } as typeof parserResult & {
          warnings: Array<{ code: string; detail: string }>;
        },
        snapshot: createSnapshot(),
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_PARSE_VERSION_CONFLICT",
      status: 409,
    });
  });

  it("detects actual semantic value changes as a parse version conflict", async () => {
    const parserResult = createParserResult();
    createParseRunClient({
      id: "parse-run-1",
      snapshot_id: "snapshot-1",
      parser_version: "hit-sist-google-docs-v1",
      status: "review_required",
      started_at: "2026-08-23T18:40:00.000Z",
      completed_at: "2026-08-23T18:40:00.000Z",
      summary: {
        ...parserResult.summary,
        warningCount: 2,
      },
      result_payload: {
        ...parserResult,
        summary: {
          ...parserResult.summary,
          warningCount: 2,
        },
      },
      failure_code: null,
      failure_metadata: {},
    });

    await expect(
      persistSourceSnapshotParseRun({
        parserResult,
        snapshot: createSnapshot(),
      }),
    ).rejects.toMatchObject({
      code: "SOURCE_PARSE_VERSION_CONFLICT",
      status: 409,
    });
  });
});
