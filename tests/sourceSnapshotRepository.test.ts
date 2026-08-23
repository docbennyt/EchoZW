import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  acceptRelaySourceSnapshot,
  getRelaySourceByKey,
} from "../server/sourceSnapshotRepository";

function createSourceRow() {
  return {
    id: "source-1",
    source_key: "hit-sist-master-sem1-2026",
    display_name: "HIT SIST Master Timetable - Semester I 2026",
    provider: "google_docs_apps_script",
    external_file_id: "1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q",
    active: true,
    last_observed_at: null,
    last_snapshot_received_at: null,
    last_successful_snapshot_at: null,
    last_error_at: null,
    last_error_code: null,
  };
}

function createPayload() {
  return {
    schemaVersion: 1 as const,
    sourceId: "hit-sist-master-sem1-2026",
    provider: "google_docs_apps_script" as const,
    fileId: "1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q",
    fileName: "SIST_Master_Timetable_Semester1_2026(Final Draft)",
    observedAt: "2026-08-22T08:30:00.000Z",
    contentHash: "hash-abc",
    tabs: [
      {
        id: "t.0",
        title: "Tab 1",
        text: "Hello world",
        tables: [[["Time", "Monday"]]],
      },
    ],
  };
}

describe("source snapshot repository", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("loads the configured relay source by key", async () => {
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: createSourceRow(),
              error: null,
            })),
          })),
        })),
      })),
    });

    await expect(
      getRelaySourceByKey("hit-sist-master-sem1-2026"),
    ).resolves.toMatchObject({
      sourceKey: "hit-sist-master-sem1-2026",
      provider: "google_docs_apps_script",
    });
  });

  it("returns unchanged when the unique source hash already exists", async () => {
    const updates: Record<string, unknown>[] = [];

    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "timetable_source_snapshots") {
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
                    data: { id: "snapshot-1", content_hash: "hash-abc" },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }

        if (table === "timetable_sources") {
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

    const result = await acceptRelaySourceSnapshot({
      source: {
        id: "source-1",
        sourceKey: "hit-sist-master-sem1-2026",
        displayName: "HIT",
        provider: "google_docs_apps_script",
        externalFileId: "1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q",
        active: true,
        lastObservedAt: null,
        lastSnapshotReceivedAt: null,
        lastSuccessfulSnapshotAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
      },
      payload: createPayload(),
      contentHash: "hash-abc",
      tabCount: 1,
      tableCount: 1,
      textLength: 11,
    });

    expect(result).toEqual({
      status: "unchanged",
      snapshotId: "snapshot-1",
      contentHash: "hash-abc",
    });
    expect(updates).toHaveLength(1);
  });
});
