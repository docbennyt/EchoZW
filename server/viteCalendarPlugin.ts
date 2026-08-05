import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Plugin } from "vite";
import { mapToGoogleEvents } from "../src/domain/googleCalendar.js";
import { demoTimetable } from "../src/domain/timetableData.js";
import {
  createPersonalizedCalendar,
  generateIcsFromPersonalizedCalendar,
} from "../src/domain/calendar.js";
import {
  buildSubscriptionResponse,
  createSubscriptionRecord,
  getReminderOffsets,
  subscriptionRequestSchema,
  type CalendarSubscription,
} from "../src/domain/subscriptions.js";
import {
  getPublicAppUrlFromHeaders,
  isExternallyFetchableUrl,
} from "../src/domain/publicUrl.js";
import { googleCalendarScope } from "../src/domain/googleScopes.js";
import { generateFeedToken, sha256Base64Url } from "../src/domain/token.js";

const subscriptionsById = new Map<string, CalendarSubscription>();
const subscriptionIdByTokenHash = new Map<string, string>();
const googleStates = new Map<string, string>();
const storePath =
  process.env.CALENDAR_STORE_PATH ??
  (process.env.NODE_ENV === "production" && process.platform !== "win32"
    ? "/data/echo-calendar-store.json"
    : ".data/calendar-store.json");
let storeLoaded = false;

function getRequestPublicOrigin(
  req: IncomingMessage,
  mode: "development" | "production",
) {
  return getPublicAppUrlFromHeaders(process.env, req.headers, mode);
}

async function loadStore() {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as { subscriptions: CalendarSubscription[] };
    for (const subscription of parsed.subscriptions ?? []) {
      subscriptionsById.set(subscription.id, subscription);
      if (subscription.tokenHash) {
        subscriptionIdByTokenHash.set(subscription.tokenHash, subscription.id);
      }
    }
  } catch {
    // Fresh deployments start with an empty store.
  }
}

async function persistStore() {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(
      {
        subscriptions: [...subscriptionsById.values()].map(
          ({ rawToken: _rawToken, ...subscription }) => subscription,
        ),
      },
      null,
      2,
    ),
  );
}

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

function confirmationReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
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

export async function handleCalendarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mode: "development" | "production",
) {
  await loadStore();
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && requestUrl.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, service: "echo-calendar" });
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
      await persistStore();

      const publicOrigin = getRequestPublicOrigin(req, mode);
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

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/account/delete-request"
  ) {
    try {
      const parsedBody = JSON.parse((await readBody(req)) || "{}") as {
        email?: string;
        details?: string;
      };
      const reference = confirmationReference("DEL");
      sendJson(res, 202, {
        ok: true,
        reference,
        message:
          "Deletion request received. We will review matching account, subscription, and support records before confirmation.",
        retained:
          "Some records may be retained where needed for security, legal compliance, accounting, fraud prevention, or audit integrity.",
        contact: parsedBody.email ?? null,
      });
      return true;
    } catch {
      sendJson(res, 400, {
        error: {
          code: "BAD_REQUEST",
          message: "We could not read the deletion request.",
        },
      });
      return true;
    }
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/calendar/google/disconnect"
  ) {
    let parsedBody: {
      subscriptionId?: string;
      deleteCreatedCalendar?: boolean;
    };
    try {
      parsedBody = JSON.parse((await readBody(req)) || "{}") as {
        subscriptionId?: string;
        deleteCreatedCalendar?: boolean;
      };
    } catch {
      sendJson(res, 400, {
        error: {
          code: "BAD_REQUEST",
          message: "We could not read the Google disconnect request.",
        },
      });
      return true;
    }

    const subscription = parsedBody.subscriptionId
      ? subscriptionsById.get(parsedBody.subscriptionId)
      : undefined;

    if (subscription) {
      subscription.status = "disconnected";
      subscription.lastErrorCode = undefined;
      subscription.updatedAt = new Date().toISOString();
      subscription.externalCalendarId = parsedBody.deleteCreatedCalendar
        ? undefined
        : subscription.externalCalendarId;
      await persistStore();
    }

    sendJson(res, 200, {
      ok: true,
      reference: confirmationReference("GDC"),
      message:
        "Google Calendar connection disconnected. Stored OAuth credentials are discarded when present; this MVP does not persist raw OAuth tokens.",
      deletedCreatedCalendar: Boolean(parsedBody.deleteCreatedCalendar),
    });
    return true;
  }

  const revokeMatch = requestUrl.pathname.match(
    /^\/api\/calendar\/subscriptions\/([^/]+)\/revoke$/,
  );
  if (req.method === "POST" && revokeMatch) {
    const subscription = subscriptionsById.get(
      decodeURIComponent(revokeMatch[1]),
    );
    if (!subscription) {
      sendJson(res, 404, {
        error: {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: "We could not find that calendar subscription.",
        },
      });
      return true;
    }

    subscription.status = "revoked";
    subscription.revokedAt = new Date().toISOString();
    subscription.updatedAt = subscription.revokedAt;
    subscription.rawToken = undefined;
    await persistStore();
    sendJson(res, 200, {
      ok: true,
      reference: confirmationReference("REV"),
      message:
        "Calendar subscription revoked. Future feed requests will not work.",
    });
    return true;
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
    await persistStore();
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
    const subscriptionId = requestUrl.searchParams.get("subscriptionId");
    const subscription = subscriptionId
      ? subscriptionsById.get(subscriptionId)
      : undefined;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!subscription) {
      sendJson(res, 404, {
        error: {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: "We could not find this calendar setup. Please try again.",
        },
      });
      return true;
    }

    if (!clientId || !redirectUri) {
      const publicOrigin = getRequestPublicOrigin(req, mode);
      res.writeHead(302, {
        Location: `${publicOrigin}/t/${demoTimetable.slug}?calendar=google-setup-needed`,
      });
      res.end();
      return true;
    }

    const state = crypto.randomUUID();
    googleStates.set(state, subscription.id);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", googleCalendarScope);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return true;
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/calendar/google/callback"
  ) {
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const subscriptionId = state ? googleStates.get(state) : undefined;
    const subscription = subscriptionId
      ? subscriptionsById.get(subscriptionId)
      : undefined;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const publicOrigin = getRequestPublicOrigin(req, mode);

    if (
      !code ||
      !state ||
      !subscription ||
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      res.writeHead(302, {
        Location: `${publicOrigin}/t/${demoTimetable.slug}?calendar=google-setup-needed`,
      });
      res.end();
      return true;
    }

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) throw new Error("Token exchange failed.");
      const tokenBody = (await tokenResponse.json()) as {
        access_token: string;
      };

      const calendarResponse = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenBody.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: subscription.calendarName,
            timeZone: subscription.timezone,
          }),
        },
      );
      if (!calendarResponse.ok) throw new Error("Calendar creation failed.");
      const calendar = (await calendarResponse.json()) as { id: string };

      for (const event of mapToGoogleEvents(demoTimetable, subscription)) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            calendar.id,
          )}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenBody.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: event.summary,
              location: event.location,
              start: event.start,
              end: event.end,
              recurrence: event.recurrence,
              reminders: event.reminders,
              extendedProperties: event.extendedProperties,
            }),
          },
        );
      }

      subscription.status = "active";
      subscription.externalCalendarId = calendar.id;
      subscription.lastSyncedAt = new Date().toISOString();
      await persistStore();
      googleStates.delete(state);
      res.writeHead(302, {
        Location: `${publicOrigin}/t/${demoTimetable.slug}?calendar=google-success`,
      });
      res.end();
    } catch {
      subscription.status = "failed";
      subscription.lastErrorCode = "GOOGLE_SYNC_FAILED";
      await persistStore();
      res.writeHead(302, {
        Location: `${publicOrigin}/t/${demoTimetable.slug}?calendar=google-failed`,
      });
      res.end();
    }
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
