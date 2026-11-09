import { z } from "zod";
import { PilotApiError } from "./pilotRepository.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export const examReminderPreferenceSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    offsets: z.array(z.number().int().min(1).max(40320)).max(5),
    consent: z.boolean(),
  })
  .strict()
  .refine((value) => value.offsets.length === 0 || value.consent, {
    message: "Choose examination reminders before enabling them.",
  });

function requireOwner(owner: string | null) {
  if (!owner || !z.string().uuid().safeParse(owner).success)
    throw new PilotApiError(
      "FORBIDDEN",
      "Use the browser where you connected this calendar.",
      403,
    );
  return owner;
}

export async function listOwnedExamReminderPreferences(
  timetableId: string,
  owner: string | null,
  env: NodeJS.ProcessEnv,
) {
  const session = requireOwner(owner);
  if (!z.string().uuid().safeParse(timetableId).success)
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Choose a valid timetable.",
      422,
    );
  const { data, error } = await createSupabaseAdminClient(env)
    .from("calendar_subscriptions")
    .select("id, provider, exam_reminder_offsets_minutes")
    .eq("timetable_id", timetableId)
    .eq("anonymous_session_id", session)
    .eq("status", "active")
    .is("revoked_at", null);
  if (error)
    throw new PilotApiError(
      "EXAM_REMINDERS_UNAVAILABLE",
      "Examination reminder settings are temporarily unavailable.",
      503,
    );
  return {
    subscriptions: (data ?? []).map((row) => ({
      id: row.id as string,
      provider: row.provider as string,
      offsets: row.exam_reminder_offsets_minutes as number[],
    })),
  };
}

export async function updateOwnedExamReminderPreferences(
  input: unknown,
  owner: string | null,
  env: NodeJS.ProcessEnv,
) {
  const session = requireOwner(owner);
  const parsed = examReminderPreferenceSchema.safeParse(input);
  if (!parsed.success)
    throw new PilotApiError(
      "VALIDATION_ERROR",
      "Choose valid examination reminders and confirm your choice.",
      422,
    );
  const offsets = [...new Set(parsed.data.offsets)].sort((a, b) => b - a);
  const { data, error } = await createSupabaseAdminClient(env)
    .from("calendar_subscriptions")
    .update({ exam_reminder_offsets_minutes: offsets })
    .eq("id", parsed.data.subscriptionId)
    .eq("anonymous_session_id", session)
    .eq("status", "active")
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error)
    throw new PilotApiError(
      "EXAM_REMINDERS_UNAVAILABLE",
      "Could not save examination reminder settings. Please try again.",
      503,
    );
  if (!data)
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "An active calendar belonging to this browser was not found.",
      404,
    );
  return { offsets };
}
