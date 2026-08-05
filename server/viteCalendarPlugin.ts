import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { demoTimetable } from "../src/domain/timetableData";
import {
  createPersonalizedCalendar,
  generateIcsFromPersonalizedCalendar,
} from "../src/domain/calendar";
import {
  buildSubscriptionResponse,
  createSubscriptionRecord,
  getReminderOffsets,
  subscriptionRequestSchema,
  type CalendarSubscription,
} from "../src/domain/subscriptions";
import {
  getPublicAppUrl,
  isExternallyFetchableUrl,
} from "../src/domain/publicUrl";
import { generateFeedToken, sha256Base64Url } from "../src/domain/token";

const subscriptionsById = new Map<string, CalendarSubscription>();
const subscriptionIdByTokenHash = new Map<string, string>();

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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
  return getCookie(req, "echo_anon_session") ?? crypto.randomUUID();
}

function safeCalendarFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function writeIcsResponse(
  req: IncomingMessage,
  res: ServerResponse,
  subscription: CalendarSubscription,
) {
  const calendar = createPersonalizedCalendar({
    subscriptionId: subscription.id,
    calendarName: subscription.calendarName,
    timetable: demoTimetable,
    reminderOffsetsMinutes: subscription.reminderOffsetsMinutes,
  });
  const ics = generateIcsFromPersonalizedCalendar(calendar);
  const etag = `"${Buffer.from(
    `${subscription.id}:${subscription.updatedAt}:${demoTimetable.version}`,
  )
    .toString("base64url")
    .slice(0, 32)}"`;

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${safeCalendarFileName(
      subscription.calendarName,
    )}.ics"`,
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=60",
    ETag: etag,
    "Last-Modified": new Date(subscription.updatedAt).toUTCString(),
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(ics);
}

async function handleCalendarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mode: "development" | "production",
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

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

      if (parsed.data.timetableId !== demoTimetable.id) {
        sendJson(res, 404, {
          error: {
            code: "TIMETABLE_NOT_FOUND",
            message: "This timetable is not published or does not exist.",
          },
        });
        return true;
      }

      const reminderOffsetsMinutes = getReminderOffsets(
        parsed.data.reminderPreset,
        parsed.data.customReminderOffsets,
      );
      const rawToken =
        parsed.data.provider === "google_api" ? undefined : generateFeedToken();
      const tokenHash = rawToken ? await sha256Base64Url(rawToken) : undefined;
      const anonymousSessionId = getOrCreateAnonymousSession(req);
      const subscription = createSubscriptionRecord({
        timetable: demoTimetable,
        provider: parsed.data.provider,
        reminderPreset: parsed.data.reminderPreset,
        reminderOffsetsMinutes,
        anonymousSessionId,
        rawToken,
        tokenHash,
      });

      subscriptionsById.set(subscription.id, subscription);
      if (tokenHash) subscriptionIdByTokenHash.set(tokenHash, subscription.id);

      const publicOrigin = getPublicAppUrl(process.env, mode);
      const response = buildSubscriptionResponse({
        subscription,
        publicOrigin,
        timetable: demoTimetable,
        externallyFetchable: isExternallyFetchableUrl(publicOrigin),
      });

      sendJson(res, 201, response, {
        "Set-Cookie": `echo_anon_session=${anonymousSessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
      });
      return true;
    } catch (error) {
      sendJson(res, 400, {
        error: {
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Could not read request.",
        },
      });
      return true;
    }
  }

  const feedMatch = requestUrl.pathname.match(
    /^\/calendar\/feed\/([^/]+)\.ics$/,
  );
  if ((req.method === "GET" || req.method === "HEAD") && feedMatch) {
    const token = decodeURIComponent(feedMatch[1]);
    const tokenHash = await sha256Base64Url(token);
    const subscriptionId = subscriptionIdByTokenHash.get(tokenHash);
    const subscription = subscriptionId
      ? subscriptionsById.get(subscriptionId)
      : undefined;

    if (!subscription || subscription.status === "revoked") {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      });
      res.end("Calendar feed not found.");
      return true;
    }

    subscription.lastFeedFetchAt = new Date().toISOString();
    writeIcsResponse(req, res, subscription);
    return true;
  }

  const downloadMatch = requestUrl.pathname.match(
    /^\/calendar\/download\/([^/]+)\.ics$/,
  );
  if ((req.method === "GET" || req.method === "HEAD") && downloadMatch) {
    const subscription = subscriptionsById.get(
      decodeURIComponent(downloadMatch[1]),
    );
    if (!subscription) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Calendar download not found.");
      return true;
    }
    writeIcsResponse(req, res, subscription);
    return true;
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/calendar/google/connect"
  ) {
    sendJson(res, 501, {
      error: {
        code: "GOOGLE_CALENDAR_DISABLED",
        message:
          "Google Calendar sync is implemented behind a feature flag and needs OAuth credentials before it can connect.",
      },
    });
    return true;
  }

  return false;
}

export function calendarMvpPlugin(): Plugin {
  return {
    name: "echo-calendar-mvp-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await handleCalendarRequest(req, res, "development")) return;
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await handleCalendarRequest(req, res, "production")) return;
        next();
      });
    },
  };
}
