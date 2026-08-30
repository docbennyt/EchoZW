import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildFeedUrl } from "../src/domain/calendar.js";
import {
  createCalendarSubscriptionRecord,
  getCalendarSubscriptionById,
  getCalendarSubscriptionByTokenHash,
  getPublishedTimetableById,
  PilotApiError,
} from "./pilotRepository.js";
import { generatePublishedTimetableIcs } from "./publishedCalendar.js";
import { generateFeedToken, sha256Base64Url } from "../src/domain/token.js";
import {
  getReminderOffsets,
  subscriptionRequestSchema,
  toAppleDeepLinkUrl,
} from "../src/domain/subscriptions.js";
import {
  getPublicAppUrlFromHeaders,
  isExternallyFetchableUrl,
} from "../src/domain/publicUrl.js";

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

function safeCalendarFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function getCookie(req: IncomingMessage, name: string) {
  const cookie = req.headers.cookie ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getOrCreateAnonymousSession(req: IncomingMessage) {
  return getCookie(req, "calenderzw_anon_session") ?? crypto.randomUUID();
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function makeFeedEtag(ics: string) {
  return `"${createHash("sha256").update(ics, "utf8").digest("base64url")}"`;
}

function requestHasEtag(req: IncomingMessage, etag: string) {
  const header = req.headers["if-none-match"];
  if (!header) return false;
  const values = (Array.isArray(header) ? header.join(",") : header)
    .split(",")
    .map((value) => value.trim());
  return values.includes("*") || values.includes(etag);
}

function requestNotModifiedSince(req: IncomingMessage, lastModified: Date) {
  if (req.headers["if-none-match"]) return false;
  const header = req.headers["if-modified-since"];
  if (!header || Array.isArray(header)) return false;
  const parsed = Date.parse(header);
  if (Number.isNaN(parsed)) return false;
  return Math.floor(lastModified.getTime() / 1000) <= Math.floor(parsed / 1000);
}

function feedHeaders(input: {
  calendarName: string;
  ics: string;
  etag: string;
  lastModified: Date;
}) {
  return {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${safeCalendarFileName(input.calendarName)}.ics"`,
    "Content-Length": String(Buffer.byteLength(input.ics)),
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    Vary: "Accept-Encoding",
    ETag: input.etag,
    "Last-Modified": input.lastModified.toUTCString(),
  };
}

function writeIcsResponse(
  req: IncomingMessage,
  res: ServerResponse,
  calendarName: string,
  ics: string,
  lastModifiedValue: string,
) {
  const etag = makeFeedEtag(ics);
  const lastModified = new Date(lastModifiedValue);
  if (Number.isNaN(lastModified.getTime())) {
    throw new Error(
      "Published timetable has an invalid publication timestamp.",
    );
  }
  const headers = feedHeaders({ calendarName, ics, etag, lastModified });

  if (requestHasEtag(req, etag) || requestNotModifiedSince(req, lastModified)) {
    const notModifiedHeaders: Record<string, string> = { ...headers };
    delete notModifiedHeaders["Content-Length"];
    res.writeHead(304, notModifiedHeaders);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(ics);
}

export async function handlePilotCalendarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  mode: "development" | "production" = "development",
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const publicOrigin = getPublicAppUrlFromHeaders(env, req.headers, mode);

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/calendar/subscriptions"
  ) {
    try {
      const parsedBody = JSON.parse(await readBody(req));
      const parsed = subscriptionRequestSchema.safeParse(parsedBody);
      if (!parsed.success) {
        sendJson(res, 422, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid calendar subscription request.",
            details: parsed.error.flatten(),
          },
        });
        return true;
      }

      if (parsed.data.provider === "google_api") {
        sendJson(res, 422, {
          error: {
            code: "NOT_SUPPORTED",
            message: "Direct Google Calendar sync is not enabled in this MVP.",
          },
        });
        return true;
      }

      const reminderOffsetsMinutes = getReminderOffsets(
        parsed.data.reminderPreset,
        parsed.data.customReminderOffsets,
      );
      const rawToken =
        parsed.data.provider === "ics_download"
          ? undefined
          : generateFeedToken();
      const tokenHash = rawToken ? await sha256Base64Url(rawToken) : undefined;
      const anonymousSessionId = getOrCreateAnonymousSession(req);
      const subscription = await createCalendarSubscriptionRecord({
        timetableId: parsed.data.timetableId,
        provider: parsed.data.provider,
        reminderPreset: parsed.data.reminderPreset,
        reminderOffsetsMinutes,
        timezone: parsed.data.timezone,
        anonymousSessionId,
        rawToken,
        tokenHash,
      });
      const feedUrl = rawToken
        ? buildFeedUrl(publicOrigin, rawToken)
        : undefined;
      const externallyFetchable = isExternallyFetchableUrl(publicOrigin);
      const appleDeepLinkUrl =
        feedUrl && externallyFetchable
          ? toAppleDeepLinkUrl(feedUrl)
          : undefined;

      sendJson(
        res,
        201,
        {
          subscriptionId: String(subscription.id),
          provider: parsed.data.provider,
          calendarName: String(subscription.calendar_name),
          feedUrl,
          appleDeepLinkUrl,
          appleSubscribeUrl: appleDeepLinkUrl,
          downloadUrl: `${publicOrigin}/calendar/download/${encodeURIComponent(String(subscription.id))}.ics`,
          expiresAt: null,
          warnings: externallyFetchable
            ? []
            : [
                "This development URL is not externally fetchable. Use a public HTTPS tunnel or preview deployment for device subscriptions.",
              ],
        },
        {
          "Set-Cookie": `calenderzw_anon_session=${anonymousSessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
        },
      );
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  const downloadMatch = requestUrl.pathname.match(
    /^\/calendar\/download\/([^/]+)\.ics$/,
  );
  if ((req.method === "GET" || req.method === "HEAD") && downloadMatch) {
    try {
      const subscription = await getCalendarSubscriptionById(
        decodeURIComponent(downloadMatch[1]),
      );
      if (
        !subscription ||
        (subscription as Record<string, unknown>).revoked_at
      ) {
        throw new PilotApiError(
          "NOT_FOUND",
          "Calendar download not found.",
          404,
        );
      }
      const timetable = await getPublishedTimetableById(
        String((subscription as Record<string, unknown>).timetable_id),
      );
      const reminders = ((subscription as Record<string, unknown>)
        .reminder_offsets_minutes ?? []) as number[];
      const ics = generatePublishedTimetableIcs({
        timetable,
        reminderOffsetsMinutes: reminders,
        publicOrigin,
      });
      if (!timetable.publishedAt) {
        throw new PilotApiError(
          "TIMETABLE_NOT_PUBLISHED",
          "This timetable does not have a published calendar yet.",
          404,
        );
      }
      writeIcsResponse(
        req,
        res,
        String((subscription as Record<string, unknown>).calendar_name),
        ics,
        timetable.publishedAt,
      );
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  const feedMatch = requestUrl.pathname.match(
    /^\/calendar\/feed\/([^/]+)\.ics$/,
  );
  if ((req.method === "GET" || req.method === "HEAD") && feedMatch) {
    try {
      const token = decodeURIComponent(feedMatch[1]);
      const tokenHash = await sha256Base64Url(token);
      const subscription = await getCalendarSubscriptionByTokenHash(tokenHash);
      if (
        !subscription ||
        (subscription as Record<string, unknown>).revoked_at
      ) {
        throw new PilotApiError("NOT_FOUND", "Calendar feed not found.", 404);
      }
      const timetable = await getPublishedTimetableById(
        String((subscription as Record<string, unknown>).timetable_id),
      );
      const reminders = ((subscription as Record<string, unknown>)
        .reminder_offsets_minutes ?? []) as number[];
      const ics = generatePublishedTimetableIcs({
        timetable,
        reminderOffsetsMinutes: reminders,
        publicOrigin,
      });
      if (!timetable.publishedAt) {
        throw new PilotApiError(
          "TIMETABLE_NOT_PUBLISHED",
          "This timetable does not have a published calendar yet.",
          404,
        );
      }
      writeIcsResponse(
        req,
        res,
        String((subscription as Record<string, unknown>).calendar_name),
        ics,
        timetable.publishedAt,
      );
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  return false;
}
