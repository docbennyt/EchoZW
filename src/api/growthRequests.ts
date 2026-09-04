export type GrowthRequestType = "missing_timetable" | "feedback";
export type GrowthRequestStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "closed";
export type GrowthFeedbackType =
  | "timetable_problem"
  | "product_problem"
  | "suggestion"
  | "rating"
  | "other";

export type CreateGrowthRequestPayload = {
  requestType: GrowthRequestType;
  timetableId?: string;
  publicSlug?: string;
  institutionName?: string;
  programmeName?: string;
  classGroupLabel?: string;
  academicPeriodName?: string;
  feedbackType?: GrowthFeedbackType;
  rating?: number;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhoneE164?: string;
  contactConsent?: boolean;
  isClassRep?: boolean;
  canProvideSource?: boolean;
  testimonialConsent?: boolean;
  sourcePage?: string;
  website?: string;
};

export type GrowthRequestRecord = {
  id: string;
  requestType: GrowthRequestType;
  status: GrowthRequestStatus;
  timetableId: string | null;
  publicSlug: string | null;
  institutionName: string | null;
  programmeName: string | null;
  classGroupLabel: string | null;
  academicPeriodName: string | null;
  feedbackType: GrowthFeedbackType | null;
  rating: number | null;
  message: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhoneE164: string | null;
  contactConsent: boolean;
  isClassRep: boolean;
  canProvideSource: boolean;
  testimonialConsent: boolean;
  testimonialApproved: boolean;
  testimonialApprovedAt: string | null;
  testimonialApprovedBy: string | null;
  sourcePage: string | null;
  internalNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function jsonOrError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    const error = new Error(body.error?.message ?? "Request failed.");
    error.name = body.error?.code ?? "REQUEST_FAILED";
    throw error;
  }
  return body;
}

export async function createGrowthRequest(payload: CreateGrowthRequestPayload) {
  const response = await fetch("/api/public/growth-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return (await jsonOrError(response)) as {
    request: {
      id: string;
      requestType: GrowthRequestType;
      status: GrowthRequestStatus;
      createdAt: string;
    };
  };
}

export async function listGrowthRequests(
  accessToken: string,
  filters: { requestType?: GrowthRequestType; status?: GrowthRequestStatus } = {},
) {
  const params = new URLSearchParams();
  if (filters.requestType) params.set("requestType", filters.requestType);
  if (filters.status) params.set("status", filters.status);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`/api/admin/growth-requests${suffix}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "same-origin",
  });
  return (await jsonOrError(response)) as { requests: GrowthRequestRecord[] };
}

export async function updateGrowthRequest(
  accessToken: string,
  id: string,
  patch: {
    status?: GrowthRequestStatus;
    internalNote?: string | null;
    testimonialApproved?: boolean;
  },
) {
  const response = await fetch(
    `/api/admin/growth-requests/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    },
  );
  return (await jsonOrError(response)) as { request: GrowthRequestRecord };
}
