import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  createAcademicPeriod,
  createClassGroup,
  createInstitution,
  createProgramme,
  createTimetable,
  createTimetableSession,
  deleteTimetableSession,
  getTimetableEditor,
  listAcademicPeriods,
  listClassGroups,
  listInstitutions,
  listProgrammes,
  listTimetables,
  PilotApiError,
  publishTimetable,
  updateAcademicPeriod,
  updateClassGroup,
  updateInstitution,
  updateProgramme,
  updateTimetableSession,
} from "./pilotRepository.js";

const institutionSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().trim().nullable().optional(),
  slug: z.string().trim().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  active: z.boolean().optional(),
});

const programmeSchema = z.object({
  institutionId: z.string().uuid(),
  name: z.string().min(1),
  code: z.string().trim().nullable().optional(),
  slug: z.string().trim().nullable().optional(),
  active: z.boolean().optional(),
});

const classGroupSchema = z.object({
  programmeId: z.string().uuid(),
  label: z.string().min(1),
  slug: z.string().trim().nullable().optional(),
  yearLevel: z.number().int().positive().nullable().optional(),
  semesterNumber: z.number().int().positive().nullable().optional(),
  groupName: z.string().trim().nullable().optional(),
  active: z.boolean().optional(),
});

const academicPeriodSchema = z.object({
  institutionId: z.string().uuid(),
  name: z.string().min(1),
  startsOn: z.string().min(1),
  endsOn: z.string().min(1),
  active: z.boolean().optional(),
});

const timetableCreateSchema = z.object({
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

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendPilotError(res: ServerResponse, error: unknown) {
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
        details: error.details ?? null,
      },
    });
    return;
  }

  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that request. Please try again.",
    },
  });
}

function getUserId(user: { id: string }) {
  return user.id;
}

function parseUrl(req: IncomingMessage) {
  return new URL(req.url ?? "/", "http://localhost");
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, part) => sum + part.length, 0) > 1024 * 1024) {
      throw new PilotApiError("BAD_REQUEST", "Request body is too large.", 413);
    }
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as unknown) : {};
}

export async function handlePilotAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  user: { id: string },
) {
  const requestUrl = parseUrl(req);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/admin/institutions") {
      sendJson(res, 200, { institutions: await listInstitutions() });
      return true;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/institutions") {
      const parsed = institutionSchema.parse(await readJson(req));
      sendJson(res, 201, { institution: await createInstitution(parsed) });
      return true;
    }

    const institutionMatch = requestUrl.pathname.match(/^\/api\/admin\/institutions\/([^/]+)$/);
    if (req.method === "PATCH" && institutionMatch) {
      const parsed = institutionSchema.partial().parse(await readJson(req));
      sendJson(res, 200, {
        institution: await updateInstitution(decodeURIComponent(institutionMatch[1]), parsed),
      });
      return true;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/programmes") {
      const institutionId = requestUrl.searchParams.get("institutionId") ?? undefined;
      sendJson(res, 200, { programmes: await listProgrammes(institutionId) });
      return true;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/programmes") {
      const parsed = programmeSchema.parse(await readJson(req));
      sendJson(res, 201, { programme: await createProgramme(parsed) });
      return true;
    }

    const programmeMatch = requestUrl.pathname.match(/^\/api\/admin\/programmes\/([^/]+)$/);
    if (req.method === "PATCH" && programmeMatch) {
      const parsed = programmeSchema.partial().parse(await readJson(req));
      sendJson(res, 200, {
        programme: await updateProgramme(decodeURIComponent(programmeMatch[1]), parsed),
      });
      return true;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/class-groups") {
      const programmeId = requestUrl.searchParams.get("programmeId") ?? undefined;
      sendJson(res, 200, { classGroups: await listClassGroups(programmeId) });
      return true;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/class-groups") {
      const parsed = classGroupSchema.parse(await readJson(req));
      sendJson(res, 201, { classGroup: await createClassGroup(parsed) });
      return true;
    }

    const classGroupMatch = requestUrl.pathname.match(/^\/api\/admin\/class-groups\/([^/]+)$/);
    if (req.method === "PATCH" && classGroupMatch) {
      const parsed = classGroupSchema.partial().parse(await readJson(req));
      sendJson(res, 200, {
        classGroup: await updateClassGroup(decodeURIComponent(classGroupMatch[1]), parsed),
      });
      return true;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/academic-periods") {
      const institutionId = requestUrl.searchParams.get("institutionId") ?? undefined;
      sendJson(res, 200, {
        academicPeriods: await listAcademicPeriods(institutionId),
      });
      return true;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/academic-periods") {
      const parsed = academicPeriodSchema.parse(await readJson(req));
      sendJson(res, 201, { academicPeriod: await createAcademicPeriod(parsed) });
      return true;
    }

    const academicPeriodMatch = requestUrl.pathname.match(/^\/api\/admin\/academic-periods\/([^/]+)$/);
    if (req.method === "PATCH" && academicPeriodMatch) {
      const parsed = academicPeriodSchema.partial().parse(await readJson(req));
      sendJson(res, 200, {
        academicPeriod: await updateAcademicPeriod(
          decodeURIComponent(academicPeriodMatch[1]),
          parsed,
        ),
      });
      return true;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/timetables") {
      sendJson(res, 200, { timetables: await listTimetables() });
      return true;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/timetables") {
      const parsed = timetableCreateSchema.parse(await readJson(req));
      const editor = await createTimetable({ ...parsed, createdBy: getUserId(user) });
      sendJson(res, 201, {
        timetable: editor,
        draftVersion: editor.activeVersion,
      });
      return true;
    }

    const timetableMatch = requestUrl.pathname.match(/^\/api\/admin\/timetables\/([^/]+)$/);
    if (req.method === "GET" && timetableMatch) {
      const editor = await getTimetableEditor(
        decodeURIComponent(timetableMatch[1]),
        getUserId(user),
      );
      sendJson(res, 200, {
        timetable: editor,
      });
      return true;
    }

    const createSessionMatch = requestUrl.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/sessions$/,
    );
    if (req.method === "POST" && createSessionMatch) {
      const parsed = sessionSchema.parse(await readJson(req));
      sendJson(res, 201, {
        session: await createTimetableSession({
          timetableId: decodeURIComponent(createSessionMatch[1]),
          userId: getUserId(user),
          ...parsed,
        }),
      });
      return true;
    }

    const updateSessionMatch = requestUrl.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/sessions\/([^/]+)$/,
    );
    if (req.method === "PATCH" && updateSessionMatch) {
      const parsed = sessionSchema.parse(await readJson(req));
      sendJson(res, 200, {
        session: await updateTimetableSession({
          timetableId: decodeURIComponent(updateSessionMatch[1]),
          sessionId: decodeURIComponent(updateSessionMatch[2]),
          userId: getUserId(user),
          ...parsed,
        }),
      });
      return true;
    }

    if (req.method === "DELETE" && updateSessionMatch) {
      const deletedSessionId = decodeURIComponent(updateSessionMatch[2]);
      await deleteTimetableSession({
        timetableId: decodeURIComponent(updateSessionMatch[1]),
        sessionId: deletedSessionId,
        userId: getUserId(user),
      });
      sendJson(res, 200, {
        ok: true,
        deletedSessionId,
      });
      return true;
    }

    const publishMatch = requestUrl.pathname.match(
      /^\/api\/admin\/timetables\/([^/]+)\/publish$/,
    );
    if (req.method === "POST" && publishMatch) {
      const publishResult = await publishTimetable(
        decodeURIComponent(publishMatch[1]),
        getUserId(user),
      );
      sendJson(res, 200, {
        publishResult,
      });
      return true;
    }
  } catch (error) {
    sendPilotError(res, error);
    return true;
  }

  return false;
}
