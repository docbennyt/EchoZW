import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  createStaticTimetableDraft,
  createStaticTimetableImport,
  getStaticTimetableImport,
  getStaticTimetableImportOptions,
  StaticTimetableImportError,
} from "./staticTimetableImportRepository.js";

const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const uuid = z.string().uuid();
const draftSchema = z.object({
  programmeId: uuid,
  cohortId: uuid,
  academicPeriodId: uuid,
  resolutions: z
    .array(z.object({ warningId: uuid, note: z.string().trim().min(1).max(2_000) }))
    .default([]),
  sessions: z
    .array(
      z.object({
        candidateKey: z.string().trim().min(1).max(200),
        courseCode: z.string().trim().min(1).max(50),
        courseName: z.string().trim().min(1).max(250),
        weekday: z.number().int().min(1).max(7),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        venue: z.string().trim().max(250).nullable().optional(),
        lecturer: z.string().trim().max(250).nullable().optional(),
        sessionType: z.string().trim().max(100).nullable().optional(),
        deliveryModeRaw: z.string().trim().max(250).nullable().optional(),
      }),
    )
    .min(1)
    .max(250),
});

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof StaticTimetableImportError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_ERROR",
        message: "The static timetable review request is invalid.",
        details: error.flatten(),
      },
    });
    return;
  }
  console.error("Static timetable import failed.", error);
  sendJson(res, 500, {
    error: {
      code: "STATIC_IMPORT_FAILED",
      message: "CalenderZW could not complete the static timetable import.",
    },
  });
}

async function readRawBody(req: IncomingMessage, limit: number) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new StaticTimetableImportError(
      "FILE_TOO_LARGE",
      "The DOCX file exceeds the 10 MB import limit.",
      413,
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new StaticTimetableImportError(
        "FILE_TOO_LARGE",
        "The DOCX file exceeds the 10 MB import limit.",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new StaticTimetableImportError(
      "EMPTY_FILE",
      "Choose a DOCX timetable document to import.",
      422,
    );
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage) {
  const raw = await readRawBody(req, 1024 * 1024);
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new StaticTimetableImportError(
      "INVALID_JSON",
      "The review request body is not valid JSON.",
      400,
    );
  }
}

function filenameFromHeader(req: IncomingMessage) {
  const raw = req.headers["x-calenderzw-filename"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw new StaticTimetableImportError(
      "FILENAME_REQUIRED",
      "The source filename is required.",
      422,
    );
  }
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export async function handleStaticTimetableImportAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  user: { id: string },
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const base = "/api/admin/static-timetable-imports";

  if (req.method === "GET" && url.pathname === `${base}/options`) {
    try {
      const rawInstitution = url.searchParams.get("institutionId");
      const institutionId = rawInstitution ? uuid.parse(rawInstitution) : null;
      sendJson(res, 200, {
        options: await getStaticTimetableImportOptions(institutionId),
      });
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === `${base}/docx`) {
    try {
      const institutionId = uuid.parse(url.searchParams.get("institutionId"));
      const filename = filenameFromHeader(req);
      const mimeType = String(req.headers["content-type"] ?? "application/octet-stream")
        .split(";")[0]
        .trim();
      const bytes = await readRawBody(req, MAX_DOCX_BYTES);
      const review = await createStaticTimetableImport({
        institutionId,
        actorId: user.id,
        filename,
        mimeType,
        bytes,
      });
      sendJson(res, 201, { review });
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  const match = url.pathname.match(
    /^\/api\/admin\/static-timetable-imports\/([0-9a-f-]+)(?:\/(draft))?$/i,
  );
  if (!match) return false;

  try {
    const batchId = uuid.parse(match[1]);
    const action = match[2] ?? null;
    if (req.method === "GET" && !action) {
      sendJson(res, 200, { review: await getStaticTimetableImport(batchId) });
      return true;
    }
    if (req.method === "POST" && action === "draft") {
      const parsed = draftSchema.parse(await readJson(req));
      const draft = await createStaticTimetableDraft({
        batchId,
        actorId: user.id,
        ...parsed,
      });
      sendJson(res, 201, { draft });
      return true;
    }
    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
  } catch (error) {
    sendError(res, error);
  }
  return true;
}
