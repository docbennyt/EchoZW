import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { buildCzwImportTemplateXlsx } from "./staticTimetableInputAdapters.js";
import {
  createStaticTimetableDraft,
  createStaticTimetableImport,
  getStaticTimetableImport,
  getStaticTimetableImportOptions,
  updateStaticTimetableImportTargetMapping,
  StaticTimetableImportError,
} from "./staticTimetableImportRepository.js";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const uuid = z.string().uuid();
const sourceContextSchema = z.object({
  programmeName: z.string().trim().max(250).nullable().optional(),
  scopeLabel: z.string().trim().max(250).nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  semesterNumber: z.coerce.number().int().min(1).max(4).nullable().optional(),
});
const targetMappingSchema = z.object({
  programmeId: uuid.nullable(),
  cohortId: uuid.nullable(),
  academicPeriodId: uuid.nullable(),
});

const draftSchema = z.object({
  targetId: uuid.nullable().optional(),
  programmeId: uuid,
  cohortId: uuid,
  academicPeriodId: uuid,
  resolutions: z
    .array(
      z.object({
        warningId: uuid,
        note: z.string().trim().min(1).max(2_000),
      }),
    )
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof StaticTimetableImportError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
      },
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
      "The timetable source exceeds the 10 MB import limit.",
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
        "The timetable source exceeds the 10 MB import limit.",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new StaticTimetableImportError(
      "EMPTY_FILE",
      "Choose a timetable source to import.",
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

function mimeFromRequest(req: IncomingMessage) {
  const mimeType = String(
    req.headers["content-type"] ?? "application/octet-stream",
  )
    .split(";")[0]
    .trim()
    .toLowerCase();
  return mimeType || "application/octet-stream";
}

function sourceContextFromRequest(req: IncomingMessage) {
  const raw = req.headers["x-calenderzw-import-context"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  try {
    return sourceContextSchema.parse(JSON.parse(decodeURIComponent(value)));
  } catch {
    throw new StaticTimetableImportError(
      "IMPORT_CONTEXT_INVALID",
      "The optional import context is not valid.",
      422,
    );
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

  if (req.method === "GET" && url.pathname === `${base}/template.xlsx`) {
    try {
      const bytes = await buildCzwImportTemplateXlsx();
      res.writeHead(200, {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="CZW Timetable Import v1.xlsx"',
        "Cache-Control": "no-store",
      });
      res.end(bytes);
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  if (
    req.method === "POST" &&
    (url.pathname === `${base}/docx` || url.pathname === `${base}/source`)
  ) {
    try {
      const institutionId = uuid.parse(url.searchParams.get("institutionId"));
      const filename = filenameFromHeader(req);
      const mimeType =
        url.pathname === `${base}/docx` ? DOCX_MIME_TYPE : mimeFromRequest(req);
      const bytes = await readRawBody(req, MAX_SOURCE_BYTES);
      const context = sourceContextFromRequest(req);
      const review = await createStaticTimetableImport({
        institutionId,
        actorId: user.id,
        filename,
        mimeType,
        bytes,
        context,
      });
      sendJson(res, 201, { review });
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  const targetMatch = url.pathname.match(
    /^\/api\/admin\/static-timetable-imports\/([0-9a-f-]+)\/targets\/([0-9a-f-]+)$/i,
  );
  if (targetMatch) {
    try {
      if (req.method !== "PATCH") {
        sendJson(res, 405, {
          error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
        });
        return true;
      }
      const batchId = uuid.parse(targetMatch[1]);
      const targetId = uuid.parse(targetMatch[2]);
      const parsed = targetMappingSchema.parse(await readJson(req));
      sendJson(res, 200, {
        review: await updateStaticTimetableImportTargetMapping({
          batchId,
          targetId,
          ...parsed,
        }),
      });
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
