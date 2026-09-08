import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type {
  AcademicPauseImpact,
  AcademicSchedulePause,
  PublicTimetable,
} from "../src/api/pilotTypes.js";
import { withCandidatePause } from "../src/domain/academicPause.js";
import {
  addDaysToDateKey,
  resolveScheduleForDate,
} from "../src/domain/resolvedSchedule.js";
import {
  AcademicPauseRepositoryError,
  createAcademicPause,
  deactivateAcademicPause,
  listAcademicPausesForTimetable,
  listPublishedTimetableIdsForPauseScope,
  type AcademicPauseInput,
} from "./academicPauseRepository.js";
import { syncGoogleSubscriptionsForTimetable } from "./googleCalendarSync.js";
import { getPublishedTimetableById } from "./pilotRepository.js";
import type { StaffAuthContext } from "./supabase/auth.js";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pauseSchema = z.object({
  scopeType: z.enum([
    "institution",
    "programme",
    "cohort",
    "timetable",
    "session",
  ]),
  institutionId: z.string().uuid().nullable().optional(),
  programmeId: z.string().uuid().nullable().optional(),
  cohortId: z.string().uuid().nullable().optional(),
  timetableId: z.string().uuid().nullable().optional(),
  stableSessionKey: z.string().trim().min(1).nullable().optional(),
  startsOn: dateKey,
  endsOn: dateKey,
  allDay: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.enum([
    "sim_break",
    "graduation",
    "swot_week",
    "holiday",
    "closure",
    "other",
  ]),
  label: z.string().trim().min(1).max(120),
  provenance: z.string().trim().max(500).nullable().optional(),
});

const scopedPauseSchema = pauseSchema
  .omit({
    institutionId: true,
    programmeId: true,
    cohortId: true,
    timetableId: true,
  })
  .extend({
    scopeType: z.enum(["timetable", "session"]).default("timetable"),
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

function occurrenceKey(
  occurrence: ReturnType<typeof resolveScheduleForDate>[number],
) {
  return `${occurrence.session.stableSessionKey}|${occurrence.start.toISOString()}|${occurrence.end.toISOString()}`;
}

function candidateRule(pause: AcademicPauseInput): AcademicSchedulePause {
  return {
    id: "preview-academic-pause",
    scopeType: pause.scopeType,
    stableSessionKey:
      pause.scopeType === "session" ? (pause.stableSessionKey ?? null) : null,
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    allDay: pause.allDay,
    startsAt: pause.allDay ? null : (pause.startsAt ?? null),
    endsAt: pause.allDay ? null : (pause.endsAt ?? null),
    reason: pause.reason,
    label: pause.label,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

function countNewlySuppressed(
  timetable: PublicTimetable,
  pause: AcademicPauseInput,
) {
  const withPause = withCandidatePause(timetable, candidateRule(pause));
  const startsOn =
    timetable.startsOn && timetable.startsOn > pause.startsOn
      ? timetable.startsOn
      : pause.startsOn;
  const endsOn =
    timetable.endsOn && timetable.endsOn < pause.endsOn
      ? timetable.endsOn
      : pause.endsOn;
  if (endsOn < startsOn) return 0;

  let total = 0;
  for (
    let current = startsOn;
    current <= endsOn;
    current = addDaysToDateKey(current, 1)
  ) {
    const before = resolveScheduleForDate(timetable, current);
    const afterKeys = new Set(
      resolveScheduleForDate(withPause, current).map(occurrenceKey),
    );
    total += before.filter(
      (occurrence) => !afterKeys.has(occurrenceKey(occurrence)),
    ).length;
  }
  return total;
}

async function previewImpact(pause: AcademicPauseInput): Promise<{
  impact: AcademicPauseImpact;
  timetableIds: string[];
}> {
  const timetableIds = await listPublishedTimetableIdsForPauseScope(pause);
  let newlySuppressedLectureCount = 0;
  for (const timetableId of timetableIds) {
    const timetable = await getPublishedTimetableById(timetableId);
    newlySuppressedLectureCount += countNewlySuppressed(timetable, pause);
  }
  return {
    impact: {
      affectedTimetableCount: timetableIds.length,
      newlySuppressedLectureCount,
    },
    timetableIds,
  };
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

function scopedInput(timetableId: string, body: unknown): AcademicPauseInput {
  const parsed = scopedPauseSchema.parse(body);
  return {
    ...parsed,
    timetableId,
    institutionId: null,
    programmeId: null,
    cohortId: null,
    stableSessionKey:
      parsed.scopeType === "session" ? (parsed.stableSessionKey ?? null) : null,
  };
}

function broadInput(body: unknown): AcademicPauseInput {
  return pauseSchema.parse(body);
}

function inputFromStoredPause(
  pause: Awaited<ReturnType<typeof deactivateAcademicPause>>,
): AcademicPauseInput {
  return {
    scopeType: pause.scopeType,
    institutionId: pause.institutionId,
    programmeId: pause.programmeId,
    cohortId: pause.cohortId,
    timetableId: pause.timetableId,
    stableSessionKey: pause.stableSessionKey,
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    allDay: pause.allDay,
    startsAt: pause.startsAt,
    endsAt: pause.endsAt,
    reason: pause.reason,
    label: pause.label,
    provenance: pause.provenance,
  };
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
        const { impact, timetableIds } = await previewImpact(pauseInput);
        const pause = await createAcademicPause({ actor, pause: pauseInput });
        const googleCalendarSync = await syncAffectedCalendars(timetableIds);
        sendJson(res, 201, { pause, impact, googleCalendarSync });
        return true;
      }
      const itemMatch = url.pathname.match(
        new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)$`),
      );
      if (req.method === "DELETE" && itemMatch) {
        const pause = await deactivateAcademicPause({
          actor,
          pauseId: decodeURIComponent(itemMatch[1]),
          timetableId: scopedTimetableId,
        });
        const timetableIds = await listPublishedTimetableIdsForPauseScope(
          inputFromStoredPause(pause),
        );
        const googleCalendarSync = await syncAffectedCalendars(timetableIds);
        sendJson(res, 200, { pause, googleCalendarSync });
        return true;
      }
      return false;
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
      const { impact, timetableIds } = await previewImpact(pauseInput);
      const pause = await createAcademicPause({ actor, pause: pauseInput });
      const googleCalendarSync = await syncAffectedCalendars(timetableIds);
      sendJson(res, 201, { pause, impact, googleCalendarSync });
      return true;
    }
    const broadItemMatch = url.pathname.match(
      /^\/api\/admin\/academic-pauses\/([^/]+)$/,
    );
    if (req.method === "DELETE" && broadItemMatch) {
      const pause = await deactivateAcademicPause({
        actor,
        pauseId: decodeURIComponent(broadItemMatch[1]),
      });
      const timetableIds = await listPublishedTimetableIdsForPauseScope(
        inputFromStoredPause(pause),
      );
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
