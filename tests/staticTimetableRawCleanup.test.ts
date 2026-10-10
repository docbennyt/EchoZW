import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import { cleanupEligibleStaticTimetableRawSources } from "../server/staticTimetableRawCleanup";

type Row = Record<string, unknown>;

const NOW = new Date("2026-10-10T12:00:00.000Z");

function sourceRow(
  id: string,
  input: {
    eligibleAt: string;
    reason: string;
    status?: string;
    storagePath?: string;
    documentType?: string;
  },
): Row {
  return {
    id,
    document_type: input.documentType ?? "static_timetable_document",
    metadata: {
      parsedMetadata: { departmentName: "Biomedical Engineering" },
      rawRetention: {
        policy: "private_raw_source_cleanup",
        rawDeleteEligibleAt: input.eligibleAt,
        reason: input.reason,
        cleanupStatus: input.status,
      },
    },
    storage_path: input.storagePath ?? `${id}/source.docx`,
  };
}

function createCleanupClient(
  rows: Row[],
  options: {
    removeErrors?: Record<string, Row | null>;
  } = {},
) {
  const state = {
    evidence: {
      importCandidates: [{ id: "candidate-1" }],
      importCandidateTargets: [{ id: "target-link-1" }],
      importCandidateWarnings: [{ id: "warning-1", resolution_note: "ok" }],
      timetableVersions: [{ id: "draft-version-1" }],
    },
    removedPaths: [] as string[],
    touchedTables: [] as string[],
    updates: [] as Array<{ id: string; metadata: Row }>,
  };

  function shouldSelect(row: Row, filters: Row) {
    if (filters.document_type && row.document_type !== filters.document_type) {
      return false;
    }
    const retention = ((row.metadata as Row).rawRetention ?? {}) as Row;
    if (filters.policy && retention.policy !== filters.policy) {
      return false;
    }
    if (
      filters.eligibleAt &&
      String(retention.rawDeleteEligibleAt) > filters.eligibleAt
    ) {
      return false;
    }
    return true;
  }

  function tableApi(table: string) {
    state.touchedTables.push(table);
    const filters: Row = {};
    return {
      select() {
        return {
          eq(column: string, value: unknown) {
            if (column === "metadata->rawRetention->>policy") {
              filters.policy = value;
            } else {
              filters[column] = value;
            }
            return this;
          },
          lte(column: string, value: unknown) {
            if (column === "metadata->rawRetention->>rawDeleteEligibleAt") {
              filters.eligibleAt = value;
            }
            return this;
          },
          limit(limit: number) {
            return Promise.resolve({
              data: rows
                .filter((row) => shouldSelect(row, filters))
                .slice(0, limit),
              error: null,
            });
          },
        };
      },
      update(payload: Row) {
        return {
          eq(column: string, value: unknown) {
            if (column !== "id") {
              return Promise.resolve({
                data: null,
                error: { message: "unexpected filter" },
              });
            }
            const row = rows.find((candidate) => candidate.id === value);
            if (row) {
              row.metadata = payload.metadata;
              state.updates.push({
                id: String(value),
                metadata: payload.metadata as Row,
              });
            }
            return Promise.resolve({ data: row ?? null, error: null });
          },
        };
      },
    };
  }

  const client = {
    from: vi.fn((table: string) => tableApi(table)),
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn((paths: string[]) => {
          state.removedPaths.push(...paths.map((path) => `${bucket}:${path}`));
          const path = paths[0];
          const error = options.removeErrors?.[path] ?? null;
          return Promise.resolve({ data: error ? null : [], error });
        }),
      })),
    },
  };

  return { client, state, rows };
}

describe("static timetable raw source cleanup", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("does not delete unresolved raw source before the 7 day eligibility boundary", async () => {
    const row = sourceRow("unresolved", {
      eligibleAt: "2026-10-10T13:00:00.000Z",
      reason: "unresolved_or_failed_import_review",
    });
    const { client, state } = createCleanupClient([row]);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(result.deleted).toBe(0);
    expect(state.removedPaths).toEqual([]);
  });

  it("deletes unresolved raw source at or after the 7 day eligibility boundary", async () => {
    const row = sourceRow("unresolved", {
      eligibleAt: NOW.toISOString(),
      reason: "unresolved_or_failed_import_review",
    });
    const { client, state, rows } = createCleanupClient([row]);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(result.deleted).toBe(1);
    expect(state.removedPaths).toEqual([
      "timetable-sources:unresolved/source.docx",
    ]);
    expect((rows[0].metadata as Row).rawRetention as Row).toMatchObject({
      cleanupStatus: "deleted",
      rawDeletedAt: NOW.toISOString(),
      reason: "unresolved_or_failed_import_review",
    });
  });

  it("does not delete verified-draft raw source before the 24 hour eligibility boundary", async () => {
    const row = sourceRow("draft", {
      eligibleAt: "2026-10-10T13:00:00.000Z",
      reason: "verified_draft_created",
    });
    const { client, state } = createCleanupClient([row]);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(result.deleted).toBe(0);
    expect(state.removedPaths).toEqual([]);
  });

  it("deletes verified-draft raw source at or after the 24 hour eligibility boundary", async () => {
    const row = sourceRow("draft", {
      eligibleAt: NOW.toISOString(),
      reason: "verified_draft_created",
    });
    const { client, state } = createCleanupClient([row]);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(result.deleted).toBe(1);
    expect(state.removedPaths).toEqual(["timetable-sources:draft/source.docx"]);
  });

  it("preserves structured import evidence, mappings, resolutions and draft rows", async () => {
    const row = sourceRow("source", {
      eligibleAt: NOW.toISOString(),
      reason: "verified_draft_created",
    });
    const { client, state } = createCleanupClient([row]);
    const evidenceBefore = structuredClone(state.evidence);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(state.evidence).toEqual(evidenceBefore);
    expect(state.touchedTables).not.toContain("import_candidates");
    expect(state.touchedTables).not.toContain("import_candidate_targets");
    expect(state.touchedTables).not.toContain("import_candidate_warnings");
    expect(state.touchedTables).not.toContain("timetable_versions");
  });

  it("is idempotent when cleanup runs repeatedly", async () => {
    const row = sourceRow("source", {
      eligibleAt: NOW.toISOString(),
      reason: "verified_draft_created",
    });
    const { client, state } = createCleanupClient([row]);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const first = await cleanupEligibleStaticTimetableRawSources({ now: NOW });
    const second = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(first.deleted).toBe(1);
    expect(second.deleted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(state.removedPaths).toEqual([
      "timetable-sources:source/source.docx",
    ]);
  });

  it("treats an already-missing raw object as cleanup success", async () => {
    const row = sourceRow("missing", {
      eligibleAt: NOW.toISOString(),
      reason: "verified_draft_created",
    });
    const { client, rows } = createCleanupClient([row], {
      removeErrors: {
        "missing/source.docx": { code: "404", message: "Object not found" },
      },
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect(((rows[0].metadata as Row).rawRetention as Row).cleanupStatus).toBe(
      "deleted",
    );
  });

  it("records storage failure without corrupting evidence and remains retryable", async () => {
    const row = sourceRow("retry", {
      eligibleAt: NOW.toISOString(),
      reason: "verified_draft_created",
    });
    const { client, rows } = createCleanupClient([row], {
      removeErrors: {
        "retry/source.docx": { code: "STORAGE_DOWN", message: "try later" },
      },
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const failed = await cleanupEligibleStaticTimetableRawSources({ now: NOW });
    expect(failed.failed).toBe(1);
    expect((rows[0].metadata as Row).rawRetention as Row).toMatchObject({
      cleanupStatus: "failed",
      cleanupErrorCode: "STORAGE_DOWN",
    });

    const retryClient = createCleanupClient(rows).client;
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(retryClient);
    const retried = await cleanupEligibleStaticTimetableRawSources({
      now: NOW,
    });

    expect(retried.deleted).toBe(1);
    expect((rows[0].metadata as Row).rawRetention as Row).toMatchObject({
      cleanupStatus: "deleted",
      cleanupErrorCode: null,
    });
  });

  it("processes bounded batches only", async () => {
    const rows = ["a", "b", "c"].map((id) =>
      sourceRow(id, {
        eligibleAt: NOW.toISOString(),
        reason: "verified_draft_created",
      }),
    );
    const { client, state } = createCleanupClient(rows);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const result = await cleanupEligibleStaticTimetableRawSources({
      now: NOW,
      limit: 2,
    });

    expect(result.inspected).toBe(2);
    expect(result.deleted).toBe(2);
    expect(state.removedPaths).toEqual([
      "timetable-sources:a/source.docx",
      "timetable-sources:b/source.docx",
    ]);
  });

  it("does not touch unrelated or ineligible source objects", async () => {
    const rows = [
      sourceRow("eligible", {
        eligibleAt: NOW.toISOString(),
        reason: "verified_draft_created",
      }),
      sourceRow("future", {
        eligibleAt: "2026-10-10T13:00:00.000Z",
        reason: "verified_draft_created",
      }),
      sourceRow("other", {
        eligibleAt: NOW.toISOString(),
        reason: "verified_draft_created",
        documentType: "source_gateway_snapshot",
      }),
    ];
    const { client, state } = createCleanupClient(rows);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    await cleanupEligibleStaticTimetableRawSources({ now: NOW });

    expect(state.removedPaths).toEqual([
      "timetable-sources:eligible/source.docx",
    ]);
  });
});
