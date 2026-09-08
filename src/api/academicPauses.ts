import type {
  AcademicPauseImpact,
  AcademicPauseReason,
  AcademicSchedulePause,
  AdminAcademicSchedulePause,
} from "./pilotTypes";
import { adminFetch } from "./pilotAdmin";

export type TimetablePauseInput = {
  scopeType: "timetable" | "session";
  stableSessionKey?: string | null;
  startsOn: string;
  endsOn: string;
  allDay: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  reason: AcademicPauseReason;
  label: string;
  provenance?: string | null;
};

export type BroadPauseInput = TimetablePauseInput & {
  scopeType: "institution" | "programme" | "cohort" | "timetable" | "session";
  institutionId?: string | null;
  programmeId?: string | null;
  cohortId?: string | null;
  timetableId?: string | null;
};

export function previewTimetablePause(
  accessToken: string,
  timetableId: string,
  input: TimetablePauseInput,
) {
  return adminFetch<{ impact: AcademicPauseImpact }>(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses/preview`,
    { method: "POST", accessToken, body: input },
  );
}

export function createTimetablePause(
  accessToken: string,
  timetableId: string,
  input: TimetablePauseInput,
) {
  return adminFetch<{
    pause: AdminAcademicSchedulePause;
    impact: AcademicPauseImpact;
    googleCalendarSync: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  }>(`/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses`, {
    method: "POST",
    accessToken,
    body: input,
  });
}

export function listTimetablePauses(accessToken: string, timetableId: string) {
  return adminFetch<{ pauses: AdminAcademicSchedulePause[] }>(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses`,
    { accessToken },
  );
}

export function deactivateTimetablePause(
  accessToken: string,
  timetableId: string,
  pauseId: string,
) {
  return adminFetch<{
    pause: AdminAcademicSchedulePause;
    googleCalendarSync: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  }>(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses/${encodeURIComponent(pauseId)}`,
    { method: "DELETE", accessToken },
  );
}

export function listAcademicPauses(accessToken: string) {
  return adminFetch<{ pauses: AdminAcademicSchedulePause[] }>(
    "/api/admin/academic-pauses",
    { accessToken },
  );
}

export function deactivateBroadPause(accessToken: string, pauseId: string) {
  return adminFetch<{
    pause: AdminAcademicSchedulePause;
    googleCalendarSync: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  }>(`/api/admin/academic-pauses/${encodeURIComponent(pauseId)}`, {
    method: "DELETE",
    accessToken,
  });
}

export function previewBroadPause(accessToken: string, input: BroadPauseInput) {
  return adminFetch<{ impact: AcademicPauseImpact }>(
    "/api/admin/academic-pauses/preview",
    { method: "POST", accessToken, body: input },
  );
}

export function createBroadPause(accessToken: string, input: BroadPauseInput) {
  return adminFetch<{
    pause: AdminAcademicSchedulePause;
    impact: AcademicPauseImpact;
    googleCalendarSync: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  }>("/api/admin/academic-pauses", {
    method: "POST",
    accessToken,
    body: input,
  });
}

export function publicPauseLabel(pause: AcademicSchedulePause) {
  return pause.label || pause.reason.replaceAll("_", " ");
}
