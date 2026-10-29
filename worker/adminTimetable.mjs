/* global Response, URL, TextDecoder */
import { z } from "zod";
import {
  PilotApiError,
  createTimetable,
  getTimetableEditor,
  createTimetableSession,
  updateTimetableSession,
  deleteTimetableSession,
  publishTimetable,
} from "../server/pilotRepository.ts";
import {
  AdminAuthError,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const timetableRoute = new RegExp(
  `^/api/admin/timetables/(${uuid})(?:/(sessions)(?:/(${uuid}))?|/(publish))?$`,
  "i",
);
const createSchema = z.object({
  institutionId: z.string().uuid(),
  programmeId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  academicPeriodId: z.string().uuid(),
});
const sessionSchema = z.object({
  courseCode: z.string().min(1),
  courseName: z.string().min(1),
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  venue: z.string().trim().nullable().optional(),
  lecturer: z.string().trim().nullable().optional(),
  sessionType: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      ...headers,
    },
  });
}

async function readJson(request) {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    throw new PilotApiError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use application/json.",
      415,
    );
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new PilotApiError(
            "BODY_TOO_LARGE",
            "Request body is too large.",
            413,
          );
        }
        raw += decoder.decode(value, { stream: true });
      }
    }
    raw += decoder.decode();
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof PilotApiError) throw error;
    throw new PilotApiError("VALIDATION_FAILED", "Invalid JSON request.", 422);
  } finally {
    reader?.releaseLock();
  }
}

// Return null for routes owned by other transports. The caller supplies routing
// and release observability; all timetable business rules stay in the repository.
export async function handleNativeAdminTimetable(request, env) {
  const url = new URL(request.url);
  const match = timetableRoute.exec(url.pathname);
  const create =
    url.pathname === "/api/admin/timetables" && request.method === "POST";
  if (!match && !create) return null;
  const [, timetableId, sessions, sessionId, publish] = match ?? [];
  const methods =
    create || publish || (sessions && !sessionId)
      ? ["POST"]
      : sessionId
        ? ["PATCH", "DELETE"]
        : ["GET"];
  if (!methods.includes(request.method)) {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      { allow: methods.join(", ") },
    );
  }
  const origin = request.headers.get("origin");
  if (
    (origin !== null && origin !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return json(
      {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Use the application origin.",
        },
      },
      403,
    );
  }
  try {
    // Preserve the existing pilot admin policy: detail, draft CRUD, creation and
    // publication require an operational admin, not merely a Class Rep assignment.
    const actor = await requireOperationalAdmin(
      {
        headers: {
          authorization: request.headers.get("authorization") ?? undefined,
        },
      },
      {
        createUserClient: (token) => createSupabaseUserClient(token, env),
        createAdminClient: () => createSupabaseAdminClient(env),
      },
    );
    if (create) {
      const input = createSchema.parse(await readJson(request));
      const editor = await createTimetable(
        { ...input, createdBy: actor.user.id },
        env,
      );
      return json(
        { timetable: editor, draftVersion: editor.activeVersion },
        201,
      );
    }
    if (publish) {
      const publishResult = await publishTimetable(
        timetableId,
        actor.user.id,
        env,
      );
      return json({
        publishResult,
        delivery: { status: "pending" },
        googleCalendarSync: {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          pending: true,
        },
      });
    }
    if (!sessions) {
      return json({
        timetable: await getTimetableEditor(timetableId, actor.user.id, env),
      });
    }
    if (request.method === "DELETE") {
      await deleteTimetableSession(
        { timetableId, sessionId, userId: actor.user.id },
        env,
      );
      return json({ ok: true, deletedSessionId: sessionId });
    }
    const input = sessionSchema.parse(await readJson(request));
    const scope = { ...input, timetableId, userId: actor.user.id };
    if (sessionId) {
      return json({
        session: await updateTimetableSession({ ...scope, sessionId }, env),
      });
    }
    return json({ session: await createTimetableSession(scope, env) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Check the highlighted fields.",
            details: error.flatten().fieldErrors,
          },
        },
        422,
      );
    }
    if (error instanceof PilotApiError || error instanceof AdminAuthError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that request. Please try again.",
        },
      },
      500,
    );
  }
}
