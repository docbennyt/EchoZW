import { adminFetch } from "./pilotAdmin";

export type SourceGatewaySource = {
  id: string;
  source_key: string;
  display_name: string;
  provider: string;
  active: boolean;
  parser_profile: string | null;
  relay_secret_env_name: string | null;
  relay_secret_configured: boolean;
  last_snapshot_received_at: string | null;
  last_successful_snapshot_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_processing_completed_at: string | null;
  last_processing_error_at: string | null;
  last_processing_error_code: string | null;
};

export type SourceGatewayProgramme = {
  id: string;
  source_id: string;
  source_programme_code: string;
  display_label: string | null;
  session_count: number;
  currently_present: boolean;
  mapping_status: "unmapped" | "mapped" | "disabled" | "conflict";
  target_programme_id: string | null;
  reviewed_at: string | null;
};

export type SourceGatewayCohort = {
  id: string;
  source_id: string;
  source_cohort_code: string;
  source_programme_code: string;
  session_count: number;
  currently_present: boolean;
  mapping_status: "unmapped" | "mapped" | "disabled" | "conflict";
  target_programme_id: string | null;
  target_cohort_id: string | null;
  target_academic_period_id: string | null;
  reviewed_at: string | null;
};

export type SourceGatewayReview = {
  id: string;
  source_id: string;
  source_cohort_code: string;
  timetable_id: string;
  draft_version_id: string;
  status:
    "pending" | "approved" | "superseded" | "published" | "rejected" | "failed";
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SourceGatewayJob = {
  id: string;
  source_id: string;
  snapshot_id: string;
  status: string;
  attempt_count: number;
  last_error_code: string | null;
  result_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SourceGatewayState = {
  cohorts: SourceGatewayCohort[];
  jobs: SourceGatewayJob[];
  programmes: SourceGatewayProgramme[];
  reviews: SourceGatewayReview[];
  sources: SourceGatewaySource[];
};

export function fetchSourceGatewayState(accessToken: string) {
  return adminFetch<SourceGatewayState>("/api/admin/source-gateway", {
    accessToken,
  });
}

export function mapSourceGatewayProgramme(
  accessToken: string,
  discoveredProgrammeId: string,
  targetProgrammeId: string,
) {
  return adminFetch<{ programme: SourceGatewayProgramme }>(
    `/api/admin/source-gateway/programmes/${discoveredProgrammeId}/mapping`,
    {
      accessToken,
      body: { targetProgrammeId },
      method: "POST",
    },
  );
}

export function mapSourceGatewayCohort(
  accessToken: string,
  discoveredCohortId: string,
  input: {
    targetAcademicPeriodId: string;
    targetCohortId: string;
    targetProgrammeId: string;
  },
) {
  return adminFetch<{ cohort: SourceGatewayCohort }>(
    `/api/admin/source-gateway/cohorts/${discoveredCohortId}/mapping`,
    {
      accessToken,
      body: input,
      method: "POST",
    },
  );
}

export function processLatestSourceSnapshot(
  accessToken: string,
  sourceId: string,
) {
  return adminFetch<{ job: { status: "queued" | "existing" } }>(
    `/api/admin/source-gateway/sources/${sourceId}/process-latest`,
    {
      accessToken,
      method: "POST",
    },
  );
}
