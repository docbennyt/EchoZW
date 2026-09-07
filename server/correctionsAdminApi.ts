import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  createRecurringCorrection,
  createSessionException,
  dedupeCorrections,
  dedupeExceptions,
  listTimetableCorrections,
  replaceRecurringCorrection,
  replaceSessionException,
  restoreCorrection,
  restoreException,
  revokeCorrection,
  revokeException,
} from "./correctionsRepository.js";
import { syncGoogleSubscriptionsForTimetable } from "./googleCalendarSync.js";
import { PilotApiError } from "./pilotRepository.js";
import type { StaffAuthContext } from "./supabase/auth.js";

const correctionSchema = z.object({
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

const exceptionSchema = z.object({
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

const editCorrectionSchema = correctionSchema.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

const editExceptionSchema = exceptionSchema.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

const undoSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

const dedupeSchema = z.object({
  semanticFingerprint: z.string().trim().min(16).max(256),
});

const idempotencyKeySchema = z.string().uuid();

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function mutationKey(req: IncomingMessage) {
  const headerValue = req.headers["idempotency-key"];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) {
    // Backward compatibility for an older UI build. New clients always send the
    // key; the semantic database guard still protects exact duplicate saves.
    return randomUUID();
  }
  const parsed = idempotencyKeySchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw new PilotApiError(
      "INVALID_IDEMPOTENCY_KEY",
      "Start a new save and try again.",
      422,
    );
  }
  return parsed.data;
}

function sendCorrectionError(res: ServerResponse, error: unknown) {
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the highlighted fields.",
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof PilotApiError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that timetable correction.",
    },
  });
}

async function syncGoogleCalendars(timetableId: string) {
  try {
    return await syncGoogleSubscriptionsForTimetable(timetableId);
  } catch (error) {
    console.warn("Google Calendar timetable propagation unavailable", {
      timetableId,
      code: error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
    });
    return { attempted: 0, succeeded: 0, failed: 0, unavailable: true };
  }
}

function skippedGoogleSync() {
  return { attempted: 0, succeeded: 0, failed: 0, skipped: true };
}

export async function handleCorrectionsAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  actor: StaffAuthContext,
) {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    const correctionsMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/corrections$/,
    );
    if (req.method === "GET" && correctionsMatch) {
      sendJson(res, 200, {
        corrections: await listTimetableCorrections(
          decodeURIComponent(correctionsMatch[1]),
        ),
      });
      return true;
    }
    if (req.method === "POST" && correctionsMatch) {
      const timetableId = decodeURIComponent(correctionsMatch[1]);
      const parsed = correctionSchema.parse(await readJson(req));
      const result = await createRecurringCorrection({
        timetableId,
        actor,
        mutationKey: mutationKey(req),
        ...parsed,
      });
      const changed = result.mutationOutcome === "created";
      const googleCalendarSync = changed
        ? await syncGoogleCalendars(timetableId)
        : skippedGoogleSync();
      sendJson(res, changed ? 201 : 200, {
        correction: result.item,
        mutationOutcome: result.mutationOutcome,
        googleCalendarSync,
      });
      return true;
    }

    const dedupeCorrectionsMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/corrections\/dedupe$/,
    );
    if (req.method === "POST" && dedupeCorrectionsMatch) {
      const timetableId = decodeURIComponent(dedupeCorrectionsMatch[1]);
      const parsed = dedupeSchema.parse(await readJson(req));
      const dedupeResult = await dedupeCorrections({
        timetableId,
        actor,
        semanticFingerprint: parsed.semanticFingerprint,
      });
      const googleCalendarSync = dedupeResult.revokedCount > 0
        ? await syncGoogleCalendars(timetableId)
        : skippedGoogleSync();
      sendJson(res, 200, { dedupeResult, googleCalendarSync });
      return true;
    }

    const correctionItemMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/corrections\/([^/]+)$/,
    );
    if (correctionItemMatch) {
      const timetableId = decodeURIComponent(correctionItemMatch[1]);
      const correctionId = decodeURIComponent(correctionItemMatch[2]);
      if (req.method === "PATCH") {
        const parsed = editCorrectionSchema.parse(await readJson(req));
        const { expectedUpdatedAt, ...replacement } = parsed;
        const result = await replaceRecurringCorrection({
          timetableId,
          correctionId,
          expectedUpdatedAt,
          actor,
          mutationKey: mutationKey(req),
          ...replacement,
        });
        const changed = result.mutationOutcome === "updated";
        const googleCalendarSync = changed
          ? await syncGoogleCalendars(timetableId)
          : skippedGoogleSync();
        sendJson(res, 200, {
          correction: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
      if (req.method === "DELETE") {
        const result = await revokeCorrection({
          timetableId,
          correctionId,
          actor,
        });
        const changed = result.mutationOutcome === "revoked";
        const googleCalendarSync = changed
          ? await syncGoogleCalendars(timetableId)
          : skippedGoogleSync();
        sendJson(res, 200, {
          correction: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
      if (req.method === "POST") {
        const parsed = undoSchema.parse(await readJson(req));
        const result = await restoreCorrection({
          timetableId,
          correctionId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
          actor,
        });
        const googleCalendarSync = await syncGoogleCalendars(timetableId);
        sendJson(res, 200, {
          correction: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
    }

    const exceptionsMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/exceptions$/,
    );
    if (req.method === "POST" && exceptionsMatch) {
      const timetableId = decodeURIComponent(exceptionsMatch[1]);
      const parsed = exceptionSchema.parse(await readJson(req));
      const result = await createSessionException({
        timetableId,
        actor,
        mutationKey: mutationKey(req),
        ...parsed,
      });
      const changed = result.mutationOutcome === "created";
      const googleCalendarSync = changed
        ? await syncGoogleCalendars(timetableId)
        : skippedGoogleSync();
      sendJson(res, changed ? 201 : 200, {
        exception: result.item,
        mutationOutcome: result.mutationOutcome,
        googleCalendarSync,
      });
      return true;
    }

    const dedupeExceptionsMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/exceptions\/dedupe$/,
    );
    if (req.method === "POST" && dedupeExceptionsMatch) {
      const timetableId = decodeURIComponent(dedupeExceptionsMatch[1]);
      const parsed = dedupeSchema.parse(await readJson(req));
      const dedupeResult = await dedupeExceptions({
        timetableId,
        actor,
        semanticFingerprint: parsed.semanticFingerprint,
      });
      const googleCalendarSync = dedupeResult.revokedCount > 0
        ? await syncGoogleCalendars(timetableId)
        : skippedGoogleSync();
      sendJson(res, 200, { dedupeResult, googleCalendarSync });
      return true;
    }

    const exceptionItemMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/exceptions\/([^/]+)$/,
    );
    if (exceptionItemMatch) {
      const timetableId = decodeURIComponent(exceptionItemMatch[1]);
      const exceptionId = decodeURIComponent(exceptionItemMatch[2]);
      if (req.method === "PATCH") {
        const parsed = editExceptionSchema.parse(await readJson(req));
        const { expectedUpdatedAt, ...replacement } = parsed;
        const result = await replaceSessionException({
          timetableId,
          exceptionId,
          expectedUpdatedAt,
          actor,
          mutationKey: mutationKey(req),
          ...replacement,
        });
        const changed = result.mutationOutcome === "updated";
        const googleCalendarSync = changed
          ? await syncGoogleCalendars(timetableId)
          : skippedGoogleSync();
        sendJson(res, 200, {
          exception: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
      if (req.method === "DELETE") {
        const result = await revokeException({
          timetableId,
          exceptionId,
          actor,
        });
        const changed = result.mutationOutcome === "revoked";
        const googleCalendarSync = changed
          ? await syncGoogleCalendars(timetableId)
          : skippedGoogleSync();
        sendJson(res, 200, {
          exception: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
      if (req.method === "POST") {
        const parsed = undoSchema.parse(await readJson(req));
        const result = await restoreException({
          timetableId,
          exceptionId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
          actor,
        });
        const googleCalendarSync = await syncGoogleCalendars(timetableId);
        sendJson(res, 200, {
          exception: result.item,
          mutationOutcome: result.mutationOutcome,
          googleCalendarSync,
        });
        return true;
      }
    }
  } catch (error) {
    sendCorrectionError(res, error);
    return true;
  }

  return false;
}
