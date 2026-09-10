import type {
  AcademicPauseImpact,
  AcademicPauseReason,
  AcademicSchedulePause,
  AdminAcademicSchedulePause,
} from "./pilotTypes";
import { adminFetch } from "./pilotAdmin";
import { createClient as createSupabaseBrowserClient } from "../utils/supabase/client";

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

export type BroadPauseInput = Omit<TimetablePauseInput, "scopeType"> & {
  scopeType: "institution" | "programme" | "cohort" | "timetable" | "session";
  institutionId?: string | null;
  programmeId?: string | null;
  cohortId?: string | null;
  timetableId?: string | null;
};

async function freshAccessToken(fallback: string) {
  if (typeof window === "undefined") return fallback;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? fallback;
  } catch {
    return fallback;
  }
}

export async function previewTimetablePause(
  accessToken: string,
  timetableId: string,
  input: TimetablePauseInput,
) {
  return adminFetch<{ impact: AcademicPauseImpact }>(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses/preview`,
    {
      method: "POST",
      accessToken: await freshAccessToken(accessToken),
      body: input,
    },
  );
}

export async function createTimetablePause(
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
    accessToken: await freshAccessToken(accessToken),
    body: input,
  });
}

export async function listTimetablePauses(
  accessToken: string,
  timetableId: string,
) {
  return adminFetch<{ pauses: AdminAcademicSchedulePause[] }>(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/pauses`,
    { accessToken: await freshAccessToken(accessToken) },
  );
}

export async function deactivateTimetablePause(
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
    {
      method: "DELETE",
      accessToken: await freshAccessToken(accessToken),
    },
  );
}

export async function listAcademicPauses(accessToken: string) {
  return adminFetch<{ pauses: AdminAcademicSchedulePause[] }>(
    "/api/admin/academic-pauses",
    { accessToken: await freshAccessToken(accessToken) },
  );
}

export async function deactivateBroadPause(
  accessToken: string,
  pauseId: string,
) {
  return adminFetch<{
    pause: AdminAcademicSchedulePause;
    googleCalendarSync: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  }>(`/api/admin/academic-pauses/${encodeURIComponent(pauseId)}`, {
    method: "DELETE",
    accessToken: await freshAccessToken(accessToken),
  });
}

export async function previewBroadPause(
  accessToken: string,
  input: BroadPauseInput,
) {
  return adminFetch<{ impact: AcademicPauseImpact }>(
    "/api/admin/academic-pauses/preview",
    {
      method: "POST",
      accessToken: await freshAccessToken(accessToken),
      body: input,
    },
  );
}

export async function createBroadPause(
  accessToken: string,
  input: BroadPauseInput,
) {
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
    accessToken: await freshAccessToken(accessToken),
    body: input,
  });
}

export function publicPauseLabel(pause: AcademicSchedulePause) {
  return pause.label || pause.reason.replaceAll("_", " ");
}
