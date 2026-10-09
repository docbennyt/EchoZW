export type StaticImportMetadata = {
  departmentName: string | null;
  academicYearRaw: string | null;
  academicYear: number | null;
  yearLevel: number | null;
  semesterNumber: number | null;
  modeLabel: string | null;
  title: string | null;
};

export type StaticImportWarning = {
  id: string;
  candidateId: string;
  candidateKey: string | null;
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  fieldName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
};

export type StaticImportSession = {
  candidateKey: string;
  rawText: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
  courseCode: string;
  courseName: string | null;
  venueRaw: string | null;
  lecturerRaw: string | null;
  deliveryModeRaw: string | null;
  warningCodes: string[];
  sourceTableIndex: number;
  sourceRowIndex: number;
  sourceColumnIndex: number;
};

export type StaticImportCourseReference = {
  candidateKey: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  rawCells: string[];
  courseCodeRaw: string;
  courseCode: string;
  courseName: string;
  hoursPerWeek: number | null;
  lecturerRaw: string | null;
};

export type StaticImportUnparsedCandidate = {
  candidateKey: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  sourceColumnIndex: number;
  rawText: string;
  weekday: number;
  weekdayLabel: string;
  startTime: string;
  endTime: string;
};

export type StaticImportIgnoredRecord = {
  kind: "break" | "blank";
  sourceTableIndex: number;
  sourceRowIndex: number;
  rawText: string;
  startTime: string | null;
  endTime: string | null;
};

export type StaticImportReview = {
  batch: {
    id: string;
    status: string;
    parserVersion: string;
    createdAt: string;
    summary: {
      detectedTableCount: number;
      sessionCount: number;
      timetableContactHours: number;
      courseReferenceCount: number;
      courseReferenceHours: number;
      blockingWarningCount: number;
      warningCount: number;
    };
  };
  document: {
    id: string;
    institutionId: string;
    originalFilename: string;
    mimeType: string;
    fileSizeBytes: number;
    sha256: string;
    sourceStatus: string;
    storagePath: string;
  };
  parsed: {
    metadata: StaticImportMetadata;
    summary: StaticImportReview["batch"]["summary"];
    courses: StaticImportCourseReference[];
    sessions: StaticImportSession[];
    unparsed: StaticImportUnparsedCandidate[];
    ignored: StaticImportIgnoredRecord[];
  };
  warnings: StaticImportWarning[];
  targets: Array<{
    id: string;
    targetKey: string;
    titleRaw: string;
    academicUnitNameRaw: string | null;
    yearLevel: number | null;
    semesterNumber: number | null;
    academicYearRaw: string | null;
    reviewStatus: string;
    matchedProgrammeId: string | null;
    matchedCohortId: string | null;
    matchedAcademicPeriodId: string | null;
    createdDraft: null | {
      timetableId: string;
      draftVersionId: string;
      publicSlug: string;
      sessionCount: number;
    };
    candidateKeys: string[];
  }>;
  suggestions: {
    programmeId?: string | null;
    cohortId?: string | null;
    academicPeriodId?: string | null;
  };
  createdDraft: null | {
    timetableId: string;
    draftVersionId: string;
    publicSlug: string;
    sessionCount: number;
  };
};

export type StaticImportOptions = {
  institutions: Array<{ id: string; name: string; slug: string }>;
  programmes: Array<{
    id: string;
    institution_id: string;
    name: string;
    short_name: string | null;
    code: string | null;
  }>;
  cohorts: Array<{
    id: string;
    programme_id: string;
    code: string;
    label: string;
    level_label: string;
    year_level: number | null;
    semester_number: number | null;
    group_name: string | null;
    group_label: string | null;
  }>;
  academicPeriods: Array<{
    id: string;
    institution_id: string;
    name: string;
    academic_year: string;
    period_number: number | null;
    starts_on: string | null;
    ends_on: string | null;
  }>;
};

type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
};

export class StaticImportClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response) {
  const body = (await response.json().catch(() => null)) as
    T | ApiErrorBody | null;
  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new StaticImportClientError(
      errorBody?.error?.message ?? "Request failed.",
      errorBody?.error?.code ?? "REQUEST_FAILED",
      response.status,
      errorBody?.error?.details,
    );
  }
  return body as T;
}

export async function getStaticTimetableImportOptions(
  accessToken: string,
  institutionId?: string,
) {
  const suffix = institutionId
    ? `?institutionId=${encodeURIComponent(institutionId)}`
    : "";
  const response = await fetch(
    `/api/admin/static-timetable-imports/options${suffix}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return parseResponse<{ options: StaticImportOptions }>(response);
}

export async function uploadStaticTimetableDocx(input: {
  accessToken: string;
  institutionId: string;
  file: File;
}) {
  const response = await fetch(
    `/api/admin/static-timetable-imports/docx?institutionId=${encodeURIComponent(input.institutionId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type":
          input.file.type ||
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-calenderzw-filename": encodeURIComponent(input.file.name),
      },
      body: input.file,
    },
  );
  return parseResponse<{ review: StaticImportReview }>(response);
}

export async function getStaticTimetableImport(
  accessToken: string,
  batchId: string,
) {
  const response = await fetch(
    `/api/admin/static-timetable-imports/${batchId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  return parseResponse<{ review: StaticImportReview }>(response);
}

export async function createStaticTimetableDraft(
  accessToken: string,
  batchId: string,
  input: {
    targetId?: string | null;
    programmeId: string;
    cohortId: string;
    academicPeriodId: string;
    resolutions: Array<{ warningId: string; note: string }>;
    sessions: Array<{
      candidateKey: string;
      courseCode: string;
      courseName: string;
      weekday: number;
      startTime: string;
      endTime: string;
      venue?: string | null;
      lecturer?: string | null;
      sessionType?: string | null;
      deliveryModeRaw?: string | null;
    }>;
  },
) {
  const response = await fetch(
    `/api/admin/static-timetable-imports/${batchId}/draft`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{
    draft: {
      timetableId: string;
      draftVersionId: string;
      publicSlug: string;
      sessionCount: number;
      status: string;
    };
  }>(response);
}

export async function patchStaticTimetableTargetMapping(
  accessToken: string,
  batchId: string,
  targetId: string,
  input: {
    programmeId: string | null;
    cohortId: string | null;
    academicPeriodId: string | null;
  },
) {
  const response = await fetch(
    `/api/admin/static-timetable-imports/${batchId}/targets/${targetId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  return parseResponse<{ review: StaticImportReview }>(response);
}
