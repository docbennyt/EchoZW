import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  createAcademicPeriod,
  getTimetableEditor,
} from "../server/pilotRepository";

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
                    maybeSingle: async () => ({
                      data: timetableRow,
                      error: null,
                    }),
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
                      single: async () => ({
                        data: { id: "tt-1" },
                        error: null,
                      }),
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
                  single: async () => ({
                    data: { id: "version-1" },
                    error: null,
                  }),
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

            if (
              columns ===
              "course_code, course_name, lecturer, venue, session_type"
            ) {
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

function createAcademicPeriodClient() {
  const state = {
    insertedPeriod: null as Record<string, unknown> | null,
  };
  const institution = {
    id: "inst-1",
    name: "Harare Institute of Technology",
    short_name: "HIT",
    slug: "hit",
    timezone: "Africa/Harare",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const client = {
    from(table: string) {
      if (table === "institutions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: institution, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "academic_periods") {
        return {
          insert(payload: Record<string, unknown>) {
            state.insertedPeriod = payload;
            return {
              select() {
                return {
                  single: async () => ({
                    data: {
                      id: "period-1",
                      institution_id: payload.institution_id,
                      name: payload.name,
                      academic_year: payload.academic_year,
                      starts_on: payload.starts_on,
                      ends_on: payload.ends_on,
                      active: payload.active,
                      created_at: "2026-01-02T00:00:00.000Z",
                      updated_at: payload.updated_at,
                      institutions: { name: institution.name },
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, state };
}

describe("pilot academic period repository", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("preserves an explicit academic-year range when creating a canonical period", async () => {
    const { client, state } = createAcademicPeriodClient();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const period = await createAcademicPeriod({
      institutionId: "inst-1",
      name: "Semester 1, 2026-2027",
      academicYear: "2026-2027",
      startsOn: "2026-08-10",
      endsOn: "2027-01-16",
    });

    expect(state.insertedPeriod).toMatchObject({
      academic_year: "2026-2027",
      period_number: 1,
    });
    expect(period.academicYear).toBe("2026-2027");
  });

  it("keeps legacy callers backward-compatible when academicYear is omitted", async () => {
    const { client, state } = createAcademicPeriodClient();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    await createAcademicPeriod({
      institutionId: "inst-1",
      name: "Semester 1",
      startsOn: "2026-08-10",
      endsOn: "2027-01-16",
    });

    expect(state.insertedPeriod).toMatchObject({
      academic_year: "2026",
      period_number: 1,
    });
  });
});
