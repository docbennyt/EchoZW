import { z } from "zod";
import { createRecurringCorrection } from "./correctionsRepository.js";
import { PilotApiError } from "./pilotRepository.js";
import type { StaffAuthContext } from "./supabase/auth.js";

export const correctionSchema = z.object({
  stableSessionKey: z.string().trim().nullable().optional(),
  action: z.enum(["add", "modify", "remove"]),
  sourceMayReplace: z.boolean(),
  courseCode: z.string().trim().nullable().optional(),
  courseName: z.string().trim().nullable().optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  venue: z.string().trim().nullable().optional(),
  lecturer: z.string().trim().nullable().optional(),
  sessionType: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  reason: z.string().trim().min(1),
  provenance: z.string().trim().nullable().optional(),
});

export async function saveRecurringCorrection(
  timetableId: string,
  actor: StaffAuthContext,
  body: unknown,
  mutationKey: string,
  env?: NodeJS.ProcessEnv,
) {
  const parsed = correctionSchema.parse(body);
  if (!z.string().uuid().safeParse(mutationKey).success) {
    throw new PilotApiError(
      "INVALID_IDEMPOTENCY_KEY",
      "Start a new save and try again.",
      422,
    );
  }
  return createRecurringCorrection(
    { timetableId, actor, mutationKey, ...parsed },
    env,
  );
}
