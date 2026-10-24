import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  AcademicPauseRepositoryError,
  listAcademicPauses,
  listAcademicPausesForTimetable,
} from "./academicPauseRepository.js";
import {
  broadInput,
  scopedInput,
  previewImpact,
  createPauseWithImpact,
  deactivatePauseWithTimetables,
} from "./academicPauseCore.js";
import { syncGoogleSubscriptionsForTimetable } from "./googleCalendarSync.js";
import type { StaffAuthContext } from "./supabase/auth.js";

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

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the no-lecture period details.",
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof AcademicPauseRepositoryError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that academic pause operation.",
    },
  });
}

async function syncAffectedCalendars(timetableIds: string[]) {
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  for (const timetableId of timetableIds) {
    try {
      const result = await syncGoogleSubscriptionsForTimetable(timetableId);
      attempted += result.attempted;
      succeeded += result.succeeded;
      failed += result.failed;
    } catch {
      failed += 1;
    }
  }
  return { attempted, succeeded, failed };
}

export async function handleAcademicPauseAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  actor: StaffAuthContext,
  scopedTimetableId?: string,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (scopedTimetableId) {
      const root = `/api/admin/timetables/${encodeURIComponent(scopedTimetableId)}/pauses`;
      if (req.method === "GET" && url.pathname === root) {
        sendJson(res, 200, {
          pauses: await listAcademicPausesForTimetable(scopedTimetableId),
        });
        return true;
      }
      if (req.method === "POST" && url.pathname === `${root}/preview`) {
        const pause = scopedInput(scopedTimetableId, await readJson(req));
        const { impact } = await previewImpact(pause);
        sendJson(res, 200, { impact });
        return true;
      }
      if (req.method === "POST" && url.pathname === root) {
        const pauseInput = scopedInput(scopedTimetableId, await readJson(req));
        const { pause, impact, timetableIds } = await createPauseWithImpact(
          actor,
          pauseInput,
        );
        const googleCalendarSync = await syncAffectedCalendars(timetableIds);
        sendJson(res, 201, { pause, impact, googleCalendarSync });
        return true;
      }
      const itemMatch = url.pathname.match(
        new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)$`),
      );
      if (req.method === "DELETE" && itemMatch) {
        const { pause, timetableIds } = await deactivatePauseWithTimetables({
          actor,
          pauseId: decodeURIComponent(itemMatch[1]),
          timetableId: scopedTimetableId,
        });
        const googleCalendarSync = await syncAffectedCalendars(timetableIds);
        sendJson(res, 200, { pause, googleCalendarSync });
        return true;
      }
      return false;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/academic-pauses") {
      sendJson(res, 200, { pauses: await listAcademicPauses() });
      return true;
    }
    if (
      req.method === "POST" &&
      url.pathname === "/api/admin/academic-pauses/preview"
    ) {
      const pause = broadInput(await readJson(req));
      const { impact } = await previewImpact(pause);
      sendJson(res, 200, { impact });
      return true;
    }
    if (
      req.method === "POST" &&
      url.pathname === "/api/admin/academic-pauses"
    ) {
      const pauseInput = broadInput(await readJson(req));
      const { pause, impact, timetableIds } = await createPauseWithImpact(
        actor,
        pauseInput,
      );
      const googleCalendarSync = await syncAffectedCalendars(timetableIds);
      sendJson(res, 201, { pause, impact, googleCalendarSync });
      return true;
    }
    const broadItemMatch = url.pathname.match(
      /^\/api\/admin\/academic-pauses\/([^/]+)$/,
    );
    if (req.method === "DELETE" && broadItemMatch) {
      const { pause, timetableIds } = await deactivatePauseWithTimetables({
        actor,
        pauseId: decodeURIComponent(broadItemMatch[1]),
      });
      const googleCalendarSync = await syncAffectedCalendars(timetableIds);
      sendJson(res, 200, { pause, googleCalendarSync });
      return true;
    }
  } catch (error) {
    sendError(res, error);
    return true;
  }
  return false;
}
