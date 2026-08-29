import type {
  AdminAcademicPeriod,
  AdminClassGroup,
  DeleteTimetableSessionResponse,
  AdminInstitution,
  AdminProgramme,
  AdminTimetableEditor,
  AdminTimetableSession,
  AdminTimetableSummary,
  PublishTimetableResponse,
} from "./pilotTypes";

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken: string;
  body?: unknown;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class PilotClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function adminFetch<T>(path: string, options: ApiOptions): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = (await response.json().catch(() => null)) as
    T | ApiErrorBody | null;
  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new PilotClientError(
      errorBody?.error?.message ?? "Request failed.",
      errorBody?.error?.code ?? "REQUEST_FAILED",
      response.status,
      errorBody?.error?.details,
    );
  }

  return body as T;
}

export function listInstitutions(accessToken: string) {
  return adminFetch<{ institutions: AdminInstitution[] }>(
    "/api/admin/institutions",
    {
      accessToken,
    },
  );
}

export function createInstitution(
  accessToken: string,
  input: {
    name: string;
    shortName?: string | null;
    slug?: string | null;
    timezone?: string | null;
    active?: boolean;
  },
) {
  return adminFetch<{ institution: AdminInstitution }>(
    "/api/admin/institutions",
    {
      method: "POST",
      accessToken,
      body: input,
    },
  );
}

export function updateInstitution(
  accessToken: string,
  id: string,
  input: Partial<{
    name: string;
    shortName: string | null;
    slug: string | null;
    timezone: string | null;
    active: boolean;
  }>,
) {
  return adminFetch<{ institution: AdminInstitution }>(
    `/api/admin/institutions/${id}`,
    {
      method: "PATCH",
      accessToken,
      body: input,
    },
  );
}

export function listProgrammes(accessToken: string, institutionId?: string) {
  const url = institutionId
    ? `/api/admin/programmes?institutionId=${encodeURIComponent(institutionId)}`
    : "/api/admin/programmes";
  return adminFetch<{ programmes: AdminProgramme[] }>(url, { accessToken });
}

export function createProgramme(
  accessToken: string,
  input: {
    institutionId: string;
    name: string;
    code?: string | null;
    slug?: string | null;
    active?: boolean;
  },
) {
  return adminFetch<{ programme: AdminProgramme }>("/api/admin/programmes", {
    method: "POST",
    accessToken,
    body: input,
  });
}

export function updateProgramme(
  accessToken: string,
  id: string,
  input: Partial<{
    institutionId: string;
    name: string;
    code: string | null;
    slug: string | null;
    active: boolean;
  }>,
) {
  return adminFetch<{ programme: AdminProgramme }>(
    `/api/admin/programmes/${id}`,
    {
      method: "PATCH",
      accessToken,
      body: input,
    },
  );
}

export function listClassGroups(accessToken: string, programmeId?: string) {
  const url = programmeId
    ? `/api/admin/class-groups?programmeId=${encodeURIComponent(programmeId)}`
    : "/api/admin/class-groups";
  return adminFetch<{ classGroups: AdminClassGroup[] }>(url, { accessToken });
}

export function createClassGroup(
  accessToken: string,
  input: {
    programmeId: string;
    label: string;
    slug?: string | null;
    yearLevel?: number | null;
    semesterNumber?: number | null;
    groupName?: string | null;
    active?: boolean;
  },
) {
  return adminFetch<{ classGroup: AdminClassGroup }>(
    "/api/admin/class-groups",
    {
      method: "POST",
      accessToken,
      body: input,
    },
  );
}

export function updateClassGroup(
  accessToken: string,
  id: string,
  input: Partial<{
    programmeId: string;
    label: string;
    slug: string | null;
    yearLevel: number | null;
    semesterNumber: number | null;
    groupName: string | null;
    active: boolean;
  }>,
) {
  return adminFetch<{ classGroup: AdminClassGroup }>(
    `/api/admin/class-groups/${id}`,
    {
      method: "PATCH",
      accessToken,
      body: input,
    },
  );
}

export function listAcademicPeriods(
  accessToken: string,
  institutionId?: string,
) {
  const url = institutionId
    ? `/api/admin/academic-periods?institutionId=${encodeURIComponent(institutionId)}`
    : "/api/admin/academic-periods";
  return adminFetch<{ academicPeriods: AdminAcademicPeriod[] }>(url, {
    accessToken,
  });
}

export function createAcademicPeriod(
  accessToken: string,
  input: {
    institutionId: string;
    name: string;
    startsOn: string;
    endsOn: string;
    active?: boolean;
  },
) {
  return adminFetch<{ academicPeriod: AdminAcademicPeriod }>(
    "/api/admin/academic-periods",
    {
      method: "POST",
      accessToken,
      body: input,
    },
  );
}

export function updateAcademicPeriod(
  accessToken: string,
  id: string,
  input: Partial<{
    institutionId: string;
    name: string;
    startsOn: string;
    endsOn: string;
    active: boolean;
  }>,
) {
  return adminFetch<{ academicPeriod: AdminAcademicPeriod }>(
    `/api/admin/academic-periods/${id}`,
    {
      method: "PATCH",
      accessToken,
      body: input,
    },
  );
}

export function listTimetables(accessToken: string) {
  return adminFetch<{ timetables: AdminTimetableSummary[] }>(
    "/api/admin/timetables",
    {
      accessToken,
    },
  );
}

export function createTimetable(
  accessToken: string,
  input: {
    institutionId: string;
    programmeId: string;
    classGroupId: string;
    academicPeriodId: string;
  },
) {
  return adminFetch<{ timetable: AdminTimetableEditor }>(
    "/api/admin/timetables",
    {
      method: "POST",
      accessToken,
      body: input,
    },
  );
}

export function getTimetable(accessToken: string, id: string) {
  return adminFetch<{ timetable: AdminTimetableEditor }>(
    `/api/admin/timetables/${id}`,
    {
      accessToken,
    },
  );
}

export function createTimetableSession(
  accessToken: string,
  timetableId: string,
  input: {
    courseCode: string;
    courseName: string;
    weekday: number;
    startTime: string;
    endTime: string;
    venue?: string | null;
    lecturer?: string | null;
    sessionType?: string | null;
    notes?: string | null;
  },
) {
  return adminFetch<{ session: AdminTimetableSession }>(
    `/api/admin/timetables/${timetableId}/sessions`,
    {
      method: "POST",
      accessToken,
      body: input,
    },
  );
}

export function updateTimetableSession(
  accessToken: string,
  timetableId: string,
  sessionId: string,
  input: {
    courseCode: string;
    courseName: string;
    weekday: number;
    startTime: string;
    endTime: string;
    venue?: string | null;
    lecturer?: string | null;
    sessionType?: string | null;
    notes?: string | null;
  },
) {
  return adminFetch<{ session: AdminTimetableSession }>(
    `/api/admin/timetables/${timetableId}/sessions/${sessionId}`,
    {
      method: "PATCH",
      accessToken,
      body: input,
    },
  );
}

export function deleteTimetableSession(
  accessToken: string,
  timetableId: string,
  sessionId: string,
) {
  return adminFetch<DeleteTimetableSessionResponse>(
    `/api/admin/timetables/${timetableId}/sessions/${sessionId}`,
    {
      method: "DELETE",
      accessToken,
    },
  );
}

export function publishTimetable(accessToken: string, timetableId: string) {
  return adminFetch<{ publishResult: PublishTimetableResponse }>(
    `/api/admin/timetables/${timetableId}/publish`,
    {
      method: "POST",
      accessToken,
    },
  );
}
