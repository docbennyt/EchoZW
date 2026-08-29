import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getPublishedTimetableBySlug,
  listTimetables,
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

  if (req.method === "GET" && requestUrl.pathname === "/api/public/timetables") {
    try {
      const timetables = (await listTimetables())
        .filter((timetable) => Boolean(timetable.currentPublishedVersionId))
        .map((timetable) => ({
          publicSlug: timetable.publicSlug,
          institutionName: timetable.institutionName,
          programmeName: timetable.programmeName,
          classGroupLabel: timetable.classGroupLabel,
          academicPeriodName: timetable.academicPeriodName,
          lastUpdated: timetable.lastUpdated,
        }));
      sendJson(
        res,
        200,
        { timetables },
        { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      );
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

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
