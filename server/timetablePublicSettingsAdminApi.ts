import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { StaffAuthContext } from "./supabase/auth.js";
import {
  getTimetablePublicDisplaySettings,
  updateTimetablePublicDisplaySettings,
} from "./timetablePublicSettingsRepository.js";
import { PilotApiError } from "./pilotRepository.js";

const settingsSchema = z
  .object({
    showVisualPreview: z.boolean(),
    showChangeAlerts: z.boolean(),
  })
  .strict();

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 64 * 1024) {
      throw new PilotApiError("BAD_REQUEST", "Request body is too large.", 413);
    }
    chunks.push(part);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Both public timetable settings must be provided as booleans.",
      },
    });
    return;
  }
  if (error instanceof PilotApiError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Could not manage public timetable settings.",
    },
  });
}

export async function handleTimetablePublicSettingsAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  context: StaffAuthContext,
  timetableId: string,
) {
  try {
    if (req.method === "GET") {
      sendJson(res, 200, {
        settings: await getTimetablePublicDisplaySettings(timetableId),
      });
      return true;
    }

    if (req.method === "PUT") {
      const parsed = settingsSchema.parse(await readJson(req));
      sendJson(res, 200, {
        settings: await updateTimetablePublicDisplaySettings({
          timetableId,
          staffUserId: context.staff.id,
          ...parsed,
        }),
      });
      return true;
    }

    sendJson(res, 405, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Only GET and PUT are supported for public timetable settings.",
      },
    });
    return true;
  } catch (error) {
    sendError(res, error);
    return true;
  }
}
