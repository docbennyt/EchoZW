import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildFeedUrl } from "../src/domain/calendar.js";
import {
  classifyAnalyticsClient,
  isAnalyticsUuid,
} from "../src/domain/analytics.js";
import {
  createCalendarSubscriptionRecord,
  getCalendarSubscriptionById,
  getCalendarSubscriptionByTokenHash,
  getPublishedTimetableById,
  PilotApiError,
} from "./pilotRepository.js";
import { getCalendarRevision } from "./calendarRevisionRepository.js";
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
import { recordCalendarFeedActivity } from "./analyticsRepository.js";
import { updateGoogleSubscription } from "./googleCalendarRepository.js";
import {
  beginGoogleCalendarConnection,
  completeGoogleCalendarConnection,
  disconnectGoogleCalendar,
  getPublicGoogleCalendarStatus,
} from "./googleCalendarSync.js";

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

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getCookie(req: IncomingMessage, name: string) {
  const cookie = req.headers.cookie ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getAnonymousSession(req: IncomingMessage) {
  const headerId = headerValue(req.headers["x-calenderzw-anonymous-id"]);
  if (isAnalyticsUuid(headerId)) return headerId;
  const cookieId = getCookie(req, "calenderzw_anon_session");
  return isAnalyticsUuid(cookieId) ? cookieId : null;
}

function getOrCreateAnonymousSession(req: IncomingMessage) {
  return getAnonymousSession(req) ?? crypto.randomUUID();
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
): 200 | 304 {
  const etag = makeFeedEtag(ics);
  const lastModified = new Date(lastModifiedValue);
  if (Number.isNaN(lastModified.getTime())) {
    throw new Error("Published timetable has an invalid revision timestamp.");
  }
  const headers = feedHeaders({ calendarName, ics, etag, lastModified });

  // ETag is derived from the complete personalized ICS representation and is the
  // only safe 304 validator here. If-Modified-Since alone can be stale because
  // subscribed-calendar clients only have second-level timestamp precision while
  // Class Rep corrections can change the effective schedule independently of the
  // base publication record.
  if (requestHasEtag(req, etag)) {
    const notModifiedHeaders: Record<string, string> = { ...headers };
    delete notModifiedHeaders["Content-Length"];
    res.writeHead(304, notModifiedHeaders);
    res.end();
    return 304;
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return 200;
  }
  res.end(ics);
  return 200;
}

async function buildRevisionAwareCalendar(input: {
  timetableId: string;
  reminders: number[];
  publicOrigin: string;
  env: NodeJS.ProcessEnv;
}) {
  const timetable = await getPublishedTimetableById(input.timetableId);
  if (!timetable.publishedAt) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable does not have a published calendar yet.",
      404,
    );
  }
  const revision = await getCalendarRevision(input.timetableId, input.env);
  const resolvedTimetable = {
    ...timetable,
    publishedAt: revision.updatedAt,
    versionNumber: revision.sequence,
  };
  const ics = generatePublishedTimetableIcs({
    timetable: resolvedTimetable,
    reminderOffsetsMinutes: input.reminders,
    publicOrigin: input.publicOrigin,
  });
  return { ics, revision };
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
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
    req.method === "GET" &&
    requestUrl.pathname === "/api/calendar/google/status"
  ) {
    sendJson(res, 200, getPublicGoogleCalendarStatus(env));
    return true;
  }

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

      if (
        parsed.data.provider === "google_api" &&
        !getPublicGoogleCalendarStatus(env).enabled
      ) {
        sendJson(res, 503, {
          error: {
            code: "GOOGLE_NOT_CONFIGURED",
            message: "Direct Google Calendar connection is not available right now.",
          },
        });
        return true;
      }

      const reminderOffsetsMinutes = getReminderOffsets(
        parsed.data.reminderPreset,
        parsed.data.customReminderOffsets,
      );
      const rawToken =
        parsed.data.provider === "ics_download" ||
        parsed.data.provider === "google_api"
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
        subscriberContact: parsed.data.subscriberContact,
      });
      const subscriptionId = String(subscription.id);
      if (parsed.data.provider === "google_api") {
        await updateGoogleSubscription({
          subscriptionId,
          status: "pending",
          lastErrorCode: null,
          env,
        });
      }
      const feedUrl = rawToken
        ? buildFeedUrl(publicOrigin, rawToken)
        : undefined;
      const externallyFetchable = isExternallyFetchableUrl(publicOrigin);
      const appleDeepLinkUrl =
        feedUrl && externallyFetchable
          ? toAppleDeepLinkUrl(feedUrl)
          : undefined;
      const secureCookie = mode === "production" ? "; Secure" : "";

      sendJson(
        res,
        201,
        {
          subscriptionId,
          provider: parsed.data.provider,
          calendarName: String(subscription.calendar_name),
          feedUrl,
          appleDeepLinkUrl,
          appleSubscribeUrl: appleDeepLinkUrl,
          downloadUrl:
            parsed.data.provider === "google_api"
              ? undefined
              : `${publicOrigin}/calendar/download/${encodeURIComponent(subscriptionId)}.ics`,
          googleConnectUrl:
            parsed.data.provider === "google_api"
              ? `${publicOrigin}/api/calendar/google/connect?subscriptionId=${encodeURIComponent(subscriptionId)}`
              : undefined,
          expiresAt: null,
          contact: {
            saved: Boolean(
              (subscription as Record<string, unknown>).subscriber_profile_id,
            ),
            countryCode:
              parsed.data.subscriberContact?.countryCode ?? undefined,
          },
          warnings: externallyFetchable
            ? []
            : [
                "This development URL is not externally fetchable. Use a public HTTPS deployment for calendar connections.",
              ],
        },
        {
          "Set-Cookie": `calenderzw_anon_session=${anonymousSessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secureCookie}`,
        },
      );
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/calendar/google/connect"
  ) {
    try {
      const subscriptionId = requestUrl.searchParams.get("subscriptionId");
      if (!subscriptionId) {
        throw new PilotApiError(
          "SUBSCRIPTION_NOT_FOUND",
          "We could not find this Google Calendar setup.",
          404,
        );
      }
      const authUrl = await beginGoogleCalendarConnection({
        subscriptionId,
        anonymousSessionId: getAnonymousSession(req),
        env,
      });
      redirect(res, authUrl.toString());
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/calendar/google/callback"
  ) {
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const oauthError = requestUrl.searchParams.get("error");
    if (oauthError || !code || !state) {
      redirect(
        res,
        `${publicOrigin}/find?calendar=${encodeURIComponent(oauthError || "google-cancelled")}`,
      );
      return true;
    }

    try {
      const result = await completeGoogleCalendarConnection({ code, state, env });
      redirect(
        res,
        `${publicOrigin}/t/${encodeURIComponent(result.publicSlug)}?calendar=google-success&subscriptionId=${encodeURIComponent(result.subscriptionId)}`,
      );
    } catch (error) {
      console.warn("Google Calendar callback failed", {
        code: error instanceof PilotApiError ? error.code : "GOOGLE_CALLBACK_FAILED",
      });
      redirect(res, `${publicOrigin}/find?calendar=google-failed`);
    }
    return true;
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/calendar/google/disconnect"
  ) {
    try {
      const parsedBody = JSON.parse((await readBody(req)) || "{}") as {
        subscriptionId?: string;
        deleteCreatedCalendar?: boolean;
      };
      if (!parsedBody.subscriptionId) {
        throw new PilotApiError(
          "SUBSCRIPTION_NOT_FOUND",
          "Google Calendar setup not found.",
          404,
        );
      }
      const result = await disconnectGoogleCalendar({
        subscriptionId: parsedBody.subscriptionId,
        anonymousSessionId: getAnonymousSession(req),
        deleteCreatedCalendar: Boolean(parsedBody.deleteCreatedCalendar),
        env,
      });
      sendJson(res, 200, result);
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
      const timetableId = String(
        (subscription as Record<string, unknown>).timetable_id,
      );
      const reminders = ((subscription as Record<string, unknown>)
        .reminder_offsets_minutes ?? []) as number[];
      const { ics, revision } = await buildRevisionAwareCalendar({
        timetableId,
        reminders,
        publicOrigin,
        env,
      });
      writeIcsResponse(
        req,
        res,
        String((subscription as Record<string, unknown>).calendar_name),
        ics,
        revision.updatedAt,
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
      const timetableId = String(
        (subscription as Record<string, unknown>).timetable_id,
      );
      const reminders = ((subscription as Record<string, unknown>)
        .reminder_offsets_minutes ?? []) as number[];
      const { ics, revision } = await buildRevisionAwareCalendar({
        timetableId,
        reminders,
        publicOrigin,
        env,
      });
      const statusCode = writeIcsResponse(
        req,
        res,
        String((subscription as Record<string, unknown>).calendar_name),
        ics,
        revision.updatedAt,
      );
      const subscriptionId = String(
        (subscription as Record<string, unknown>).id,
      );
      const client = classifyAnalyticsClient(
        headerValue(req.headers["user-agent"]),
      );
      void recordCalendarFeedActivity(
        { subscriptionId, statusCode, client },
        env,
      ).catch((error) => {
        console.warn("calendar feed activity unavailable", {
          subscriptionId,
          statusCode,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
    } catch (error) {
      sendError(res, error);
    }
    return true;
  }

  return false;
}
