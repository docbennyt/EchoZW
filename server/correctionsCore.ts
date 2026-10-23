import { z } from "zod";
import {
  createRecurringCorrection,
  createSessionException,
  dedupeCorrections,
  dedupeExceptions,
  replaceRecurringCorrection,
  replaceSessionException,
  restoreCorrection,
  restoreException,
  revokeCorrection,
  revokeException,
} from "./correctionsRepository.js";
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

export const exceptionSchema = z.object({
  stableSessionKey: z.string().trim().nullable().optional(),
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exceptionType: z.enum(["cancelled", "moved", "extra"]),
  replacementStartsAt: z.string().trim().nullable().optional(),
  replacementEndsAt: z.string().trim().nullable().optional(),
  courseCode: z.string().trim().nullable().optional(),
  courseName: z.string().trim().nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  venue: z.string().trim().nullable().optional(),
  lecturer: z.string().trim().nullable().optional(),
  sessionType: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  reason: z.string().trim().min(1),
  provenance: z.string().trim().nullable().optional(),
});

const expectedUpdatedAtSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});
const editCorrectionSchema = correctionSchema.extend(
  expectedUpdatedAtSchema.shape,
);
const editExceptionSchema = exceptionSchema.extend(
  expectedUpdatedAtSchema.shape,
);
const dedupeSchema = z.object({
  semanticFingerprint: z.string().trim().min(16).max(256),
});

function requireMutationKey(mutationKey: string) {
  if (!z.string().uuid().safeParse(mutationKey).success) {
    throw new PilotApiError(
      "INVALID_IDEMPOTENCY_KEY",
      "Start a new save and try again.",
      422,
    );
  }
  return mutationKey;
}

export async function saveRecurringCorrection(
  timetableId: string,
  actor: StaffAuthContext,
  body: unknown,
  mutationKey: string,
  env?: NodeJS.ProcessEnv,
) {
  const parsed = correctionSchema.parse(body);
  requireMutationKey(mutationKey);
  return createRecurringCorrection(
    { timetableId, actor, mutationKey, ...parsed },
    env,
  );
}

// Validation and mutation policy stay shared; runtime adapters only handle HTTP.
export async function applyEditorMutation(
  input: {
    timetableId: string;
    collection: "corrections" | "exceptions";
    operation: "create" | "edit" | "remove" | "undo" | "dedupe";
    itemId?: string;
    actor: StaffAuthContext;
    body: unknown;
    mutationKey: string;
  },
  env?: NodeJS.ProcessEnv,
) {
  const { timetableId, actor, body, collection, operation } = input;
  const recurring = collection === "corrections";
  const scope = { timetableId, actor };
  if (operation === "dedupe") {
    const parsed = dedupeSchema.parse(body);
    const dedupeResult = await (
      recurring ? dedupeCorrections : dedupeExceptions
    )({ ...scope, ...parsed }, env);
    return { body: { dedupeResult }, created: false };
  }
  if (operation === "create") {
    const result = recurring
      ? await saveRecurringCorrection(
          timetableId,
          actor,
          body,
          input.mutationKey,
          env,
        )
      : await createSessionException(
          {
            ...exceptionSchema.parse(body),
            ...scope,
            mutationKey: requireMutationKey(input.mutationKey),
          },
          env,
        );
    return {
      body: {
        [recurring ? "correction" : "exception"]: result.item,
        mutationOutcome: result.mutationOutcome,
      },
      created: result.mutationOutcome === "created",
    };
  }
  const itemId = z.string().uuid().parse(input.itemId);
  let result;
  if (operation === "edit") {
    const mutationKey = requireMutationKey(input.mutationKey);
    result = recurring
      ? await replaceRecurringCorrection(
          {
            ...editCorrectionSchema.parse(body),
            ...scope,
            correctionId: itemId,
            mutationKey,
          },
          env,
        )
      : await replaceSessionException(
          {
            ...editExceptionSchema.parse(body),
            ...scope,
            exceptionId: itemId,
            mutationKey,
          },
          env,
        );
  } else if (operation === "undo") {
    const parsed = expectedUpdatedAtSchema.parse(body);
    result = recurring
      ? await restoreCorrection(
          { ...scope, correctionId: itemId, ...parsed },
          env,
        )
      : await restoreException(
          { ...scope, exceptionId: itemId, ...parsed },
          env,
        );
  } else {
    result = recurring
      ? await revokeCorrection({ ...scope, correctionId: itemId }, env)
      : await revokeException({ ...scope, exceptionId: itemId }, env);
  }
  return {
    body: {
      [recurring ? "correction" : "exception"]: result.item,
      mutationOutcome: result.mutationOutcome,
    },
    created: false,
  };
}
