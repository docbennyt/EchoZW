import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  StaticTimetableImportError,
  updateStaticTimetableImportTargetMapping,
} from "../server/staticTimetableImportRepository";

type Row = Record<string, unknown>;

function createMappingClient(
  overrides: {
    programmeInstitutionId?: string;
    cohortProgrammeId?: string;
    periodInstitutionId?: string;
    targetBatchId?: string;
  } = {},
) {
  const rows = {
    batch: {
      id: "batch-1",
      source_document_id: "source-1",
      status: "review_required",
      parser_version: "static-docx-matrix-v3",
      created_at: "2026-10-09T00:00:00.000Z",
      summary: {
        summary: { sessionCount: 1 },
        metadata: { academicYearRaw: "2026-2027" },
        sessions: [{ candidateKey: "candidate-1" }],
        courses: [],
        warnings: [],
      },
    },
    source: {
      id: "source-1",
      institution_id: "inst-1",
      original_filename: "ecommerce.docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file_size_bytes: 1024,
      sha256: "sha",
      source_status: "parsed",
      storage_path: "source/ecommerce.docx",
    },
    target: {
      id: "target-1",
      import_batch_id: overrides.targetBatchId ?? "batch-1",
      target_key: "part-1-semester-1",
      title_raw: "Part 1 Semester 1",
      academic_unit_name_raw: null,
      year_level: 1,
      semester_number: 1,
      academic_year_raw: "2026-2027",
      review_status: "unreviewed",
      matched_programme_id: null,
      matched_cohort_id: null,
      matched_academic_period_id: null,
    },
    programme: {
      id: "programme-1",
      institution_id: overrides.programmeInstitutionId ?? "inst-1",
    },
    cohort: {
      id: "cohort-1",
      programme_id: overrides.cohortProgrammeId ?? "programme-1",
    },
    period: {
      id: "period-1",
      institution_id: overrides.periodInstitutionId ?? "inst-1",
    },
    candidates: [{ id: "candidate-db-1", candidate_key: "candidate-1" }],
    candidateTargets: [
      { candidate_id: "candidate-db-1", import_target_id: "target-1" },
    ],
  };
  const state = {
    targetUpdates: [] as Row[],
  };

  function result(data: unknown) {
    return Promise.resolve({ data, error: null });
  }

  function selectRows(table: string, filters: Row) {
    if (table === "import_batches") return rows.batch;
    if (table === "source_documents") return rows.source;
    if (table === "programmes") return rows.programme;
    if (table === "cohorts") return rows.cohort;
    if (table === "academic_periods") return rows.period;
    if (table === "import_targets") {
      if (filters.id && filters.id !== rows.target.id) return null;
      if (
        filters.import_batch_id &&
        filters.import_batch_id !== rows.target.import_batch_id
      ) {
        return null;
      }
      return rows.target;
    }
    return null;
  }

  function tableApi(table: string) {
    const filters: Row = {};
    return {
      select() {
        return {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return this;
          },
          in() {
            const data =
              table === "import_candidate_targets" ? rows.candidateTargets : [];
            return {
              order: () => result(data),
              then: (resolve: (value: unknown) => unknown) =>
                result(data).then(resolve),
            };
          },
          order() {
            if (table === "import_targets") return result([rows.target]);
            if (table === "import_candidate_warnings") return result([]);
            return result([]);
          },
          maybeSingle() {
            return result(selectRows(table, filters));
          },
          then(resolve: (value: unknown) => unknown) {
            if (table === "import_candidates") {
              return result(rows.candidates).then(resolve);
            }
            if (table === "timetable_versions") {
              return result([]).then(resolve);
            }
            return result([]).then(resolve);
          },
        };
      },
      update(payload: Row) {
        state.targetUpdates.push(payload);
        return {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return this;
          },
          select() {
            return {
              maybeSingle: () => {
                Object.assign(rows.target, payload);
                return result({ id: rows.target.id });
              },
            };
          },
        };
      },
    };
  }

  const client = {
    from: vi.fn((table: string) => tableApi(table)),
  };

  return { client, state };
}

describe("static timetable target mapping repository", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("persists a valid target mapping and returns it from getStaticTimetableImport", async () => {
    const { client, state } = createMappingClient();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    const review = await updateStaticTimetableImportTargetMapping({
      batchId: "batch-1",
      targetId: "target-1",
      programmeId: "programme-1",
      cohortId: "cohort-1",
      academicPeriodId: "period-1",
    });

    expect(state.targetUpdates[0]).toMatchObject({
      matched_programme_id: "programme-1",
      matched_cohort_id: "cohort-1",
      matched_academic_period_id: "period-1",
    });
    expect(review.targets[0]).toMatchObject({
      id: "target-1",
      matchedProgrammeId: "programme-1",
      matchedCohortId: "cohort-1",
      matchedAcademicPeriodId: "period-1",
      candidateKeys: ["candidate-1"],
    });
  });

  it.each([
    [
      "programme must belong to institution",
      { programmeInstitutionId: "other-inst" },
      "Programme must belong to the source institution.",
    ],
    [
      "cohort must belong to programme",
      { cohortProgrammeId: "other-programme" },
      "Class must belong to the selected programme.",
    ],
    [
      "academic period must belong to institution",
      { periodInstitutionId: "other-inst" },
      "Academic period must belong to the source institution.",
    ],
    [
      "target must belong to batch",
      { targetBatchId: "other-batch" },
      "The detected timetable target does not belong to this import.",
    ],
  ])("%s", async (_name, overrides, message) => {
    const { client } = createMappingClient(overrides);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue(client);

    await expect(
      updateStaticTimetableImportTargetMapping({
        batchId: "batch-1",
        targetId: "target-1",
        programmeId: "programme-1",
        cohortId: "cohort-1",
        academicPeriodId: "period-1",
      }),
    ).rejects.toMatchObject({
      message,
    } satisfies Partial<StaticTimetableImportError>);
  });
});
