import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getPublishedTimetableBySlug,
  PilotApiError,
} from "./pilotRepository.js";

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

function sendError(res: ServerResponse, error: unknown) {
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
      message: "We could not complete that request. Please try again.",
    },
  });
}

export async function handlePublicTimetableRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const timetableMatch = requestUrl.pathname.match(
    /^\/api\/public\/timetables\/([^/]+)$/,
  );
  if (req.method === "GET" && timetableMatch) {
    try {
      sendJson(res, 200, {
        timetable: await getPublishedTimetableBySlug(
          decodeURIComponent(timetableMatch[1]),
        ),
      });
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  return false;
}
