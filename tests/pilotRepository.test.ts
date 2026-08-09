import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import { getTimetableEditor } from "../server/pilotRepository";

function createDraftRecoveryClient() {
  let versionReadCount = 0;
  const state = {
    insertedVersions: [] as Record<string, unknown>[],
    timetableUpdates: [] as Record<string, unknown>[],
  };

  const timetableRow = {
    id: "tt-1",
    public_slug: "hit-cs-1-1-august-2026",
    institution_id: "inst-1",
    programme_id: "prog-1",
    cohort_id: "cohort-1",
    academic_period_id: "period-1",
    current_published_version_id: null,
    institutions: { name: "Harare Institute of Technology" },
    programmes: { name: "BTech Computer Science" },
    cohorts: { label: "1.1" },
    academic_periods: {
      name: "August Semester 2026",
      starts_on: "2026-08-10",
      ends_on: "2026-12-10",
    },
  };

  const client = {
    from(table: string) {
      if (table === "timetables") {
        return {
          select(columns: string) {
            if (columns.startsWith("id, public_slug")) {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: timetableRow, error: null }),
                  };
                },
              };
            }
            throw new Error(`Unexpected timetables.select(${columns})`);
          },
          update(payload: Record<string, unknown>) {
            state.timetableUpdates.push(payload);
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({ data: { id: "tt-1" }, error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "timetable_versions") {
        return {
          select(columns: string) {
            if (columns.startsWith("id, version_number")) {
              const builder = {
                eq() {
                  return builder;
                },
                order() {
                  versionReadCount += 1;
                  return Promise.resolve({
                    data:
                      versionReadCount === 1
                        ? []
                        : [
                            {
                              id: "version-1",
                              version_number: 1,
                              status: "draft",
                              published_at: null,
                              change_summary: "Initial draft",
                              created_at: "2026-08-07T10:00:00.000Z",
                            },
                          ],
                    error: null,
                  });
                },
              };
              return builder;
            }
            throw new Error(`Unexpected timetable_versions.select(${columns})`);
          },
          insert(payload: Record<string, unknown>) {
            state.insertedVersions.push(payload);
            return {
              select() {
                return {
                  single: async () => ({ data: { id: "version-1" }, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "timetable_sessions") {
        return {
          select(columns: string) {
            if (columns === "id, timetable_version_id") {
              return {
                in: async () => ({ data: [], error: null }),
              };
            }

            const builder = {
              eq() {
                return builder;
              },
              orderCallCount: 0,
              order() {
                builder.orderCallCount += 1;
                if (builder.orderCallCount < 2) {
                  return builder;
                }
                return Promise.resolve({ data: [], error: null });
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, state };
}

describe("pilot timetable repository draft recovery", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("creates an initial draft when an unpublished timetable exists without any versions", async () => {
    const { client, state } = createDraftRecoveryClient();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const editor = await getTimetableEditor("tt-1", "admin-1");

    expect(editor.timetable.id).toBe("tt-1");
    expect(editor.activeVersion.id).toBe("version-1");
    expect(editor.activeVersion.status).toBe("draft");
    expect(editor.sessions).toEqual([]);
    expect(state.insertedVersions).toHaveLength(1);
    expect(state.insertedVersions[0]).toMatchObject({
      timetable_id: "tt-1",
      version_label: "v1",
      version_number: 1,
      status: "draft",
    });
    expect(state.timetableUpdates).toEqual([
      expect.objectContaining({
        current_version_id: "version-1",
      }),
    ]);
  });
});
