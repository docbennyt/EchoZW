import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  createRecurringCorrection,
  createSessionException,
  listTimetableCorrections,
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
      const correction = await createRecurringCorrection({
        timetableId,
        actor,
        ...parsed,
      });
      const googleCalendarSync = await syncGoogleCalendars(timetableId);
      sendJson(res, 201, { correction, googleCalendarSync });
      return true;
    }

    const revokeCorrectionMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/corrections\/([^/]+)$/,
    );
    if (req.method === "DELETE" && revokeCorrectionMatch) {
      const timetableId = decodeURIComponent(revokeCorrectionMatch[1]);
      await revokeCorrection({
        timetableId,
        correctionId: decodeURIComponent(revokeCorrectionMatch[2]),
        actor,
      });
      const googleCalendarSync = await syncGoogleCalendars(timetableId);
      sendJson(res, 200, { ok: true, googleCalendarSync });
      return true;
    }

    const exceptionsMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/exceptions$/,
    );
    if (req.method === "POST" && exceptionsMatch) {
      const timetableId = decodeURIComponent(exceptionsMatch[1]);
      const parsed = exceptionSchema.parse(await readJson(req));
      const exception = await createSessionException({
        timetableId,
        actor,
        ...parsed,
      });
      const googleCalendarSync = await syncGoogleCalendars(timetableId);
      sendJson(res, 201, { exception, googleCalendarSync });
      return true;
    }

    const revokeExceptionMatch = url.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/exceptions\/([^/]+)$/,
    );
    if (req.method === "DELETE" && revokeExceptionMatch) {
      const timetableId = decodeURIComponent(revokeExceptionMatch[1]);
      await revokeException({
        timetableId,
        exceptionId: decodeURIComponent(revokeExceptionMatch[2]),
        actor,
      });
      const googleCalendarSync = await syncGoogleCalendars(timetableId);
      sendJson(res, 200, { ok: true, googleCalendarSync });
      return true;
    }
  } catch (error) {
    sendCorrectionError(res, error);
    return true;
  }

  return false;
}
