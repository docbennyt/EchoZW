import { createSupabaseAdminClient } from "./supabase/adminClient.js";

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

export type GrowthRequest = {
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

type GrowthRequestRow = {
  id: string;
  request_type: GrowthRequestType;
  status: GrowthRequestStatus;
  timetable_id: string | null;
  public_slug: string | null;
  institution_name: string | null;
  programme_name: string | null;
  class_group_label: string | null;
  academic_period_name: string | null;
  feedback_type: GrowthFeedbackType | null;
  rating: number | null;
  message: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone_e164: string | null;
  contact_consent: boolean;
  is_class_rep: boolean;
  can_provide_source: boolean;
  testimonial_consent: boolean;
  testimonial_approved: boolean;
  testimonial_approved_at: string | null;
  testimonial_approved_by: string | null;
  source_page: string | null;
  internal_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateGrowthRequestInput = {
  requestType: GrowthRequestType;
  timetableId?: string | null;
  publicSlug?: string | null;
  institutionName?: string | null;
  programmeName?: string | null;
  classGroupLabel?: string | null;
  academicPeriodName?: string | null;
  feedbackType?: GrowthFeedbackType | null;
  rating?: number | null;
  message?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhoneE164?: string | null;
  contactConsent?: boolean;
  isClassRep?: boolean;
  canProvideSource?: boolean;
  testimonialConsent?: boolean;
  sourcePage?: string | null;
};

export type GrowthRequestListFilters = {
  requestType?: GrowthRequestType;
  status?: GrowthRequestStatus;
  limit?: number;
};

export type UpdateGrowthRequestInput = {
  status?: GrowthRequestStatus;
  internalNote?: string | null;
  testimonialApproved?: boolean;
};

function mapGrowthRequest(row: GrowthRequestRow): GrowthRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    status: row.status,
    timetableId: row.timetable_id,
    publicSlug: row.public_slug,
    institutionName: row.institution_name,
    programmeName: row.programme_name,
    classGroupLabel: row.class_group_label,
    academicPeriodName: row.academic_period_name,
    feedbackType: row.feedback_type,
    rating: row.rating,
    message: row.message,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhoneE164: row.contact_phone_e164,
    contactConsent: row.contact_consent,
    isClassRep: row.is_class_rep,
    canProvideSource: row.can_provide_source,
    testimonialConsent: row.testimonial_consent,
    testimonialApproved: row.testimonial_approved,
    testimonialApprovedAt: row.testimonial_approved_at,
    testimonialApprovedBy: row.testimonial_approved_by,
    sourcePage: row.source_page,
    internalNote: row.internal_note,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createGrowthRequest(
  input: CreateGrowthRequestInput,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client
    .from("growth_requests")
    .insert({
      request_type: input.requestType,
      timetable_id: input.timetableId ?? null,
      public_slug: input.publicSlug ?? null,
      institution_name: input.institutionName ?? null,
      programme_name: input.programmeName ?? null,
      class_group_label: input.classGroupLabel ?? null,
      academic_period_name: input.academicPeriodName ?? null,
      feedback_type: input.feedbackType ?? null,
      rating: input.rating ?? null,
      message: input.message ?? null,
      contact_name: input.contactName ?? null,
      contact_email: input.contactEmail ?? null,
      contact_phone_e164: input.contactPhoneE164 ?? null,
      contact_consent: input.contactConsent ?? false,
      is_class_rep: input.isClassRep ?? false,
      can_provide_source: input.canProvideSource ?? false,
      testimonial_consent: input.testimonialConsent ?? false,
      source_page: input.sourcePage ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not save growth request: ${error?.message ?? "missing row"}`,
    );
  }
  return mapGrowthRequest(data as GrowthRequestRow);
}

export async function listGrowthRequests(
  filters: GrowthRequestListFilters = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  let query = client
    .from("growth_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(filters.limit ?? 50, 100)));

  if (filters.requestType) query = query.eq("request_type", filters.requestType);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load growth requests: ${error.message}`);
  return (data ?? []).map((row) => mapGrowthRequest(row as GrowthRequestRow));
}

export async function updateGrowthRequest(
  id: string,
  input: UpdateGrowthRequestInput,
  actorId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data: existing, error: existingError } = await client
    .from("growth_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Could not load growth request: ${existingError.message}`);
  }
  if (!existing) return null;

  const current = existing as GrowthRequestRow;
  if (input.testimonialApproved === true && !current.testimonial_consent) {
    const error = new Error("TESTIMONIAL_CONSENT_REQUIRED");
    error.name = "TESTIMONIAL_CONSENT_REQUIRED";
    throw error;
  }

  const now = new Date().toISOString();
  const nextStatus = input.status ?? current.status;
  const patch: Record<string, unknown> = { updated_at: now };
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.resolved_at =
      input.status === "resolved" || input.status === "closed"
        ? current.resolved_at ?? now
        : null;
  }
  if (input.internalNote !== undefined) {
    patch.internal_note = input.internalNote;
  }
  if (input.testimonialApproved !== undefined) {
    patch.testimonial_approved = input.testimonialApproved;
    patch.testimonial_approved_at = input.testimonialApproved ? now : null;
    patch.testimonial_approved_by = input.testimonialApproved ? actorId : null;
  }

  const { data, error } = await client
    .from("growth_requests")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `Could not update growth request: ${error?.message ?? "missing row"}`,
    );
  }

  await client.from("audit_logs").insert({
    actor_id: actorId,
    action: "growth_request.updated",
    entity_type: "growth_request",
    entity_id: id,
    metadata: {
      requestType: current.request_type,
      previousStatus: current.status,
      status: nextStatus,
      testimonialApproved:
        input.testimonialApproved ?? current.testimonial_approved,
    },
  });

  return mapGrowthRequest(data as GrowthRequestRow);
}
