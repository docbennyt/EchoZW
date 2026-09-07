import type {
  TimetableCorrectionDirective,
  TimetableMutationOutcome,
  TimetableSessionException,
} from "./pilotTypes";

export type RecurringCorrectionInput = {
  stableSessionKey?: string | null;
  action: "add" | "modify" | "remove";
  sourceMayReplace: boolean;
  courseCode?: string | null;
  courseName?: string | null;
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
  reason: string;
  provenance?: string | null;
};

export type SessionExceptionInput = {
  stableSessionKey?: string | null;
  exceptionDate: string;
  exceptionType: "cancelled" | "moved" | "extra";
  replacementStartsAt?: string | null;
  replacementEndsAt?: string | null;
  courseCode?: string | null;
  courseName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  lecturer?: string | null;
  sessionType?: string | null;
  notes?: string | null;
  reason: string;
  provenance?: string | null;
};

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class CorrectionMutationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function correctionFetch<T>(
  path: string,
  input: {
    accessToken: string;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    mutationKey?: string;
  },
) {
  const response = await fetch(path, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      ...(input.mutationKey ? { "Idempotency-Key": input.mutationKey } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | ErrorBody
    | null;
  if (!response.ok) {
    const error = body as ErrorBody | null;
    throw new CorrectionMutationError(
      error?.error?.message ?? "Could not save this timetable update.",
      error?.error?.code ?? "REQUEST_FAILED",
      response.status,
      error?.error?.details,
    );
  }
  return body as T;
}

export function listClassUpdates(accessToken: string, timetableId: string) {
  return correctionFetch<{
    corrections: {
      corrections: TimetableCorrectionDirective[];
      exceptions: TimetableSessionException[];
    };
  }>(`/api/admin/timetables/${timetableId}/corrections`, { accessToken });
}

export function createRecurringClassUpdate(
  accessToken: string,
  timetableId: string,
  mutationKey: string,
  body: RecurringCorrectionInput,
) {
  return correctionFetch<{
    correction: TimetableCorrectionDirective;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/corrections`, {
    accessToken,
    method: "POST",
    mutationKey,
    body,
  });
}

export function editRecurringClassUpdate(
  accessToken: string,
  timetableId: string,
  correctionId: string,
  mutationKey: string,
  expectedUpdatedAt: string,
  body: RecurringCorrectionInput,
) {
  return correctionFetch<{
    correction: TimetableCorrectionDirective;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/corrections/${correctionId}`, {
    accessToken,
    method: "PATCH",
    mutationKey,
    body: { ...body, expectedUpdatedAt },
  });
}

export function revokeRecurringClassUpdate(
  accessToken: string,
  timetableId: string,
  correctionId: string,
) {
  return correctionFetch<{
    correction: TimetableCorrectionDirective;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/corrections/${correctionId}`, {
    accessToken,
    method: "DELETE",
  });
}

export function restoreRecurringClassUpdate(
  accessToken: string,
  timetableId: string,
  correctionId: string,
  expectedUpdatedAt: string,
) {
  return correctionFetch<{
    correction: TimetableCorrectionDirective;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/corrections/${correctionId}`, {
    accessToken,
    method: "POST",
    body: { expectedUpdatedAt },
  });
}

export function createExtraClassUpdate(
  accessToken: string,
  timetableId: string,
  mutationKey: string,
  body: SessionExceptionInput,
) {
  return correctionFetch<{
    exception: TimetableSessionException;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/exceptions`, {
    accessToken,
    method: "POST",
    mutationKey,
    body,
  });
}

export function editSessionException(
  accessToken: string,
  timetableId: string,
  exceptionId: string,
  mutationKey: string,
  expectedUpdatedAt: string,
  body: SessionExceptionInput,
) {
  return correctionFetch<{
    exception: TimetableSessionException;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/exceptions/${exceptionId}`, {
    accessToken,
    method: "PATCH",
    mutationKey,
    body: { ...body, expectedUpdatedAt },
  });
}

export function revokeSessionException(
  accessToken: string,
  timetableId: string,
  exceptionId: string,
) {
  return correctionFetch<{
    exception: TimetableSessionException;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/exceptions/${exceptionId}`, {
    accessToken,
    method: "DELETE",
  });
}

export function restoreSessionException(
  accessToken: string,
  timetableId: string,
  exceptionId: string,
  expectedUpdatedAt: string,
) {
  return correctionFetch<{
    exception: TimetableSessionException;
    mutationOutcome: TimetableMutationOutcome;
  }>(`/api/admin/timetables/${timetableId}/exceptions/${exceptionId}`, {
    accessToken,
    method: "POST",
    body: { expectedUpdatedAt },
  });
}

export function dedupeRecurringClassUpdates(
  accessToken: string,
  timetableId: string,
  semanticFingerprint: string,
) {
  return correctionFetch<{
    dedupeResult: { keptId: string | null; revokedCount: number };
  }>(`/api/admin/timetables/${timetableId}/corrections/dedupe`, {
    accessToken,
    method: "POST",
    body: { semanticFingerprint },
  });
}

export function dedupeSessionExceptions(
  accessToken: string,
  timetableId: string,
  semanticFingerprint: string,
) {
  return correctionFetch<{
    dedupeResult: { keptId: string | null; revokedCount: number };
  }>(`/api/admin/timetables/${timetableId}/exceptions/dedupe`, {
    accessToken,
    method: "POST",
    body: { semanticFingerprint },
  });
}
