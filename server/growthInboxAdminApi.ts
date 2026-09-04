import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listGrowthInbox,
  updateFeedbackReview,
  updateTimetableRequestStatus,
} from "./growthCaptureRepository.js";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, value) => sum + value.byteLength, 0) > 16 * 1024) {
      throw new Error("INVALID_INPUT");
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("INVALID_INPUT");
  }
}

export async function handleGrowthInboxAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && pathname === "/api/admin/growth/inbox") {
    sendJson(res, 200, await listGrowthInbox(env));
    return true;
  }

  const requestMatch = pathname.match(/^\/api\/admin\/growth\/requests\/([0-9a-f-]+)$/i);
  if (req.method === "PATCH" && requestMatch) {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const status = String(body.status ?? "");
      if (!['new','triaged','source_needed','in_progress','published','closed'].includes(status)) throw new Error("INVALID_INPUT");
      const publicSlug = typeof body.publicSlug === "string" && body.publicSlug.trim()
        ? body.publicSlug.trim()
        : null;
      const request = await updateTimetableRequestStatus(
        requestMatch[1],
        status as Parameters<typeof updateTimetableRequestStatus>[1],
        publicSlug,
        env,
      );
      sendJson(res, 200, { request });
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "Could not update that request." } });
    }
    return true;
  }

  const feedbackMatch = pathname.match(/^\/api\/admin\/growth\/feedback\/([0-9a-f-]+)$/i);
  if (req.method === "PATCH" && feedbackMatch) {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const status = String(body.status ?? "");
      if (!['new','reviewed','actioned','closed'].includes(status)) throw new Error("INVALID_INPUT");
      const feedback = await updateFeedbackReview(
        feedbackMatch[1],
        {
          status: status as Parameters<typeof updateFeedbackReview>[1]['status'],
          testimonialApproved: body.testimonialApproved === true,
        },
        env,
      );
      sendJson(res, 200, { feedback });
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "Could not update that feedback." } });
    }
    return true;
  }

  return false;
}
