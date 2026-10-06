import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export type TimetableRequestInsert = {
  institutionName: string;
  programmeName: string;
  classGroup: string;
  academicPeriod?: string | null;
  semesterName?: string | null;
  requesterRole: "student" | "class_rep" | "staff" | "other";
  classRepStatus:
    "unknown" | "is_class_rep" | "knows_class_rep" | "not_class_rep";
  sourceAccess: "none" | "class_rep" | "official_link" | "document" | "other";
  sourceNote?: string | null;
  sourceDocumentName?: string | null;
  contactName?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  consentContact: boolean;
  requesterNotifyOnPublish: boolean;
};

export type FeedbackInsert = {
  category:
    | "timetable_problem"
    | "calendar_problem"
    | "product_feedback"
    | "suggestion"
    | "praise";
  rating?: number | null;
  message: string;
  publicSlug?: string | null;
  contactName?: string | null;
  email?: string | null;
  phoneE164?: string | null;
  consentContact: boolean;
  testimonialPermission: boolean;
};

export type AcquisitionQueueItem = {
  demand_key: string;
  first_requested_at: string;
  last_requested_at: string;
  request_count: number;
  notify_email_count: number;
  class_rep_lead_count: number;
  source_lead_count: number;
  has_source_document: boolean;
  current_status: string | null;
  institution_name: string;
  programme_name: string;
  class_group: string;
  academic_period: string | null;
};

function normalizeDemandPart(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function demandKeyForRequest(input: {
  institutionName: string;
  programmeName: string;
  classGroup: string;
  academicPeriod?: string | null;
  semesterName?: string | null;
}) {
  const academicPeriod =
    input.academicPeriod?.trim() || input.semesterName?.trim() || "";
  return [
    normalizeDemandPart(input.institutionName),
    normalizeDemandPart(input.programmeName),
    normalizeDemandPart(input.classGroup),
    normalizeDemandPart(academicPeriod),
  ].join("|");
}

export async function createTimetableRequest(
  input: TimetableRequestInsert,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const academicPeriod =
    input.academicPeriod?.trim() || input.semesterName?.trim() || null;
  const demandKey = demandKeyForRequest({ ...input, academicPeriod });
  const { data, error } = await client
    .from("timetable_requests")
    .insert({
      institution_name: input.institutionName,
      programme_name: input.programmeName,
      class_group: input.classGroup,
      academic_period: academicPeriod,
      semester_name: input.semesterName ?? null,
      requester_role: input.requesterRole,
      class_rep_status: input.classRepStatus,
      source_access: input.sourceAccess,
      source_note: input.sourceNote ?? null,
      source_document_name: input.sourceDocumentName ?? null,
      source_upload_status: input.sourceDocumentName ? "metadata_only" : "none",
      contact_name: input.contactName ?? null,
      phone_e164: input.phoneE164 ?? null,
      email: input.email ?? null,
      consent_contact: input.consentContact,
      requester_notify_on_publish: input.requesterNotifyOnPublish,
      institution_key: normalizeDemandPart(input.institutionName),
      programme_key: normalizeDemandPart(input.programmeName),
      class_group_key: normalizeDemandPart(input.classGroup),
      academic_period_key: normalizeDemandPart(academicPeriod),
      demand_key: demandKey,
    })
    .select("id,status,created_at,demand_key")
    .single();
  if (error)
    throw new Error(`timetable request insert failed: ${error.message}`);
  return data;
}

export async function createProductFeedback(
  input: FeedbackInsert,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client
    .from("product_feedback")
    .insert({
      category: input.category,
      rating: input.rating ?? null,
      message: input.message,
      public_slug: input.publicSlug ?? null,
      contact_name: input.contactName ?? null,
      email: input.email ?? null,
      phone_e164: input.phoneE164 ?? null,
      consent_contact: input.consentContact,
      testimonial_permission: input.testimonialPermission,
    })
    .select("id,status,created_at")
    .single();
  if (error) throw new Error(`feedback insert failed: ${error.message}`);
  return data;
}

export async function listGrowthInbox(env: NodeJS.ProcessEnv = process.env) {
  const client = createSupabaseAdminClient(env);
  const [requests, feedback, acquisitionQueue] = await Promise.all([
    client
      .from("timetable_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250),
    client
      .from("product_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250),
    client
      .from("timetable_acquisition_queue")
      .select("*")
      .order("request_count", { ascending: false })
      .order("last_requested_at", { ascending: false })
      .limit(100),
  ]);
  if (requests.error)
    throw new Error(`request inbox failed: ${requests.error.message}`);
  if (feedback.error)
    throw new Error(`feedback inbox failed: ${feedback.error.message}`);
  if (acquisitionQueue.error)
    throw new Error(
      `acquisition queue failed: ${acquisitionQueue.error.message}`,
    );
  return {
    requests: requests.data ?? [],
    feedback: feedback.data ?? [],
    acquisitionQueue:
      (acquisitionQueue.data as AcquisitionQueueItem[] | null) ?? [],
  };
}

export async function updateTimetableRequestStatus(
  id: string,
  status:
    | "new"
    | "triaged"
    | "source_needed"
    | "in_progress"
    | "published"
    | "closed",
  publicSlug: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client
    .from("timetable_requests")
    .update({
      status,
      public_slug: publicSlug,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`request status update failed: ${error.message}`);
  return data;
}

export async function updateFeedbackReview(
  id: string,
  input: {
    status: "new" | "reviewed" | "actioned" | "closed";
    testimonialApproved: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client
    .from("product_feedback")
    .update({
      status: input.status,
      testimonial_approved: input.testimonialApproved,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`feedback review update failed: ${error.message}`);
  return data;
}
