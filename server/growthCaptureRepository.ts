import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export type TimetableRequestInsert = {
  institutionName: string;
  programmeName: string;
  classGroup: string;
  academicPeriod?: string | null;
  requesterRole: "student" | "class_rep" | "staff" | "other";
  sourceAccess:
    | "none"
    | "class_rep"
    | "official_link"
    | "document"
    | "other";
  sourceNote?: string | null;
  contactName?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  consentContact: boolean;
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

export async function createTimetableRequest(
  input: TimetableRequestInsert,
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client
    .from("timetable_requests")
    .insert({
      institution_name: input.institutionName,
      programme_name: input.programmeName,
      class_group: input.classGroup,
      academic_period: input.academicPeriod ?? null,
      requester_role: input.requesterRole,
      source_access: input.sourceAccess,
      source_note: input.sourceNote ?? null,
      contact_name: input.contactName ?? null,
      phone_e164: input.phoneE164 ?? null,
      email: input.email ?? null,
      consent_contact: input.consentContact,
    })
    .select("id,status,created_at")
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

export async function listGrowthInbox(
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const [requests, feedback] = await Promise.all([
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
  ]);
  if (requests.error)
    throw new Error(`request inbox failed: ${requests.error.message}`);
  if (feedback.error)
    throw new Error(`feedback inbox failed: ${feedback.error.message}`);
  return { requests: requests.data ?? [], feedback: feedback.data ?? [] };
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
