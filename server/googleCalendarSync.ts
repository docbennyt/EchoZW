import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { PublicTimetable } from "../src/api/pilotTypes.js";
import {
  buildGoogleAuthorizationUrl,
  buildGoogleTokenExchangeBody,
  resolveGoogleOAuthConfig,
} from "../src/domain/googleOAuthConfig.js";
import { googleCalendarScope } from "../src/domain/googleScopes.js";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection.js";
import { getCalendarRevision } from "./calendarRevisionRepository.js";
import {
  consumeGoogleOAuthState,
  createGoogleOAuthState,
  deleteGoogleCredential,
  deleteGoogleEventSyncRecord,
  getCurrentPublishedVersionId,
  getGoogleCredential,
  listActiveGoogleSubscriptions,
  listGoogleEventSyncRecords,
  saveGoogleCredential,
  updateGoogleSubscription,
  upsertGoogleEventSyncRecord,
} from "./googleCalendarRepository.js";
import {
  getCalendarSubscriptionById,
  getPublishedTimetableById,
  PilotApiError,
} from "./pilotRepository.js";

type JsonRecord = Record<string, unknown>;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleEventPayload = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: string[];
  reminders: {
    useDefault: false;
    overrides: Array<{ method: "popup"; minutes: number }>;
  };
  extendedProperties: {
    private: {
      calenderzwStableSessionKey: string;
      calenderzwTimetableId: string;
    };
  };
};

const googleCalendarApi = "https://www.googleapis.com/calendar/v3";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleRevokeEndpoint = "https://oauth2.googleapis.com/revoke";

function asRecord(value: unknown) {
  return value as JsonRecord;
}

function requireGoogleConfig(env: NodeJS.ProcessEnv) {
  const config = resolveGoogleOAuthConfig(env);
  if (
    !config.enabled ||
    !config.clientId ||
    !config.clientSecret ||
    !config.redirectUri
  ) {
    throw new PilotApiError(
      "GOOGLE_NOT_CONFIGURED",
      "Google Calendar connection is not available right now.",
      503,
    );
  }
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) {
    throw new PilotApiError(
      "GOOGLE_TOKEN_ENCRYPTION_NOT_CONFIGURED",
      "Google Calendar connection is not available right now.",
      503,
    );
  }
  return config;
}

function encryptionKey(env: NodeJS.ProcessEnv) {
  const secret = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new PilotApiError(
      "GOOGLE_TOKEN_ENCRYPTION_NOT_CONFIGURED",
      "Google Calendar connection is not available right now.",
      503,
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptGoogleRefreshToken(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptGoogleRefreshToken(
  bundle: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const [version, ivValue, tagValue, encryptedValue] = bundle.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new PilotApiError(
      "GOOGLE_CREDENTIAL_INVALID",
      "Stored Google Calendar access is invalid. Please reconnect.",
      409,
    );
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(env),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new PilotApiError(
      "GOOGLE_CREDENTIAL_INVALID",
      "Stored Google Calendar access is invalid. Please reconnect.",
      409,
    );
  }
}

function stateHash(state: string) {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

async function parseGoogleJson(response: Response) {
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    return {};
  }
}

async function googleApiRequest(input: {
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  allowMissing?: boolean;
}) {
  const response = await fetch(`${googleCalendarApi}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  if (input.allowMissing && (response.status === 404 || response.status === 410)) {
    return null;
  }
  if (!response.ok) {
    const errorBody = await parseGoogleJson(response);
    throw new PilotApiError(
      "GOOGLE_API_FAILED",
      "Google Calendar could not be updated. Please try again.",
      502,
      { status: response.status, error: errorBody.error ?? null },
    );
  }
  if (response.status === 204) return null;
  return parseGoogleJson(response);
}

async function exchangeAuthorizationCode(input: {
  code: string;
  env: NodeJS.ProcessEnv;
}) {
  const config = requireGoogleConfig(input.env);
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildGoogleTokenExchangeBody({
      code: input.code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    }),
  });
  const body = (await parseGoogleJson(response)) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new PilotApiError(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      "Google Calendar authorization could not be completed. Please reconnect.",
      502,
    );
  }
  return body;
}

async function refreshAccessToken(input: {
  refreshToken: string;
  env: NodeJS.ProcessEnv;
}) {
  const config = requireGoogleConfig(input.env);
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await parseGoogleJson(response)) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new PilotApiError(
      "GOOGLE_REFRESH_FAILED",
      "Google Calendar access expired. Please reconnect CalenderZW.",
      409,
    );
  }
  return body.access_token;
}

function assertSubscriptionOwner(
  subscription: JsonRecord,
  anonymousSessionId: string | null,
) {
  const owner = subscription.anonymous_session_id
    ? String(subscription.anonymous_session_id)
    : null;
  if (!owner || !anonymousSessionId || owner !== anonymousSessionId) {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "We could not find this calendar setup. Please start again from the timetable.",
      404,
    );
  }
}

function googleEventPayload(input: {
  timetable: PublicTimetable;
  event: ReturnType<typeof projectPublishedTimetable>["events"][number];
  reminders: number[];
}): GoogleEventPayload {
  const event = input.event;
  const recurrence: string[] = [];
  if (event.recurring) {
    recurrence.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${event.recurrenceDay};UNTIL=${event.recurrenceUntilUtc}`,
    );
    for (const dateKey of event.exDates) {
      recurrence.push(
        `EXDATE;TZID=${input.timetable.institutionTimezone}:${dateKey.replaceAll("-", "")}T${event.startTime.replaceAll(":", "")}`,
      );
    }
  }

  return {
    summary: event.summary,
    description: event.description,
    location: event.venue || undefined,
    start: {
      dateTime: event.firstStartUtc,
      timeZone: input.timetable.institutionTimezone,
    },
    end: {
      dateTime: event.firstEndUtc,
      timeZone: input.timetable.institutionTimezone,
    },
    recurrence: recurrence.length ? recurrence : undefined,
    reminders: {
      useDefault: false,
      overrides: [...new Set(input.reminders)]
        .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
        .slice(0, 5)
        .map((minutes) => ({ method: "popup" as const, minutes })),
    },
    extendedProperties: {
      private: {
        calenderzwStableSessionKey: event.stableSessionKey,
        calenderzwTimetableId: input.timetable.timetableId,
      },
    },
  };
}

function contentHash(payload: GoogleEventPayload) {
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("base64url");
}

async function createSecondaryCalendar(input: {
  accessToken: string;
  calendarName: string;
  timezone: string;
}) {
  const data = await googleApiRequest({
    accessToken: input.accessToken,
    path: "/calendars",
    method: "POST",
    body: {
      summary: input.calendarName,
      description:
        "University timetable created and maintained by CalenderZW. Disconnect CalenderZW at any time from the timetable page.",
      timeZone: input.timezone,
    },
  });
  const id = data?.id ? String(data.id) : null;
  if (!id) {
    throw new PilotApiError(
      "GOOGLE_CALENDAR_CREATE_FAILED",
      "Google Calendar could not create the CalenderZW calendar.",
      502,
    );
  }
  return id;
}

async function loadAccessToken(
  subscriptionId: string,
  env: NodeJS.ProcessEnv,
) {
  const credential = await getGoogleCredential(subscriptionId, env);
  if (!credential?.encrypted_refresh_token) {
    throw new PilotApiError(
      "GOOGLE_NOT_CONNECTED",
      "Google Calendar is not connected. Please reconnect CalenderZW.",
      409,
    );
  }
  const refreshToken = decryptGoogleRefreshToken(
    String(credential.encrypted_refresh_token),
    env,
  );
  return {
    accessToken: await refreshAccessToken({ refreshToken, env }),
    refreshToken,
  };
}

export function getPublicGoogleCalendarStatus(
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = resolveGoogleOAuthConfig(env);
  return {
    enabled: Boolean(config.enabled && env.TOKEN_ENCRYPTION_KEY?.trim()),
    scope: googleCalendarScope,
  };
}

export async function beginGoogleCalendarConnection(input: {
  subscriptionId: string;
  anonymousSessionId: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const config = requireGoogleConfig(env);
  const subscription = asRecord(
    await getCalendarSubscriptionById(input.subscriptionId),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "We could not find this Google Calendar setup.",
      404,
    );
  }
  assertSubscriptionOwner(subscription, input.anonymousSessionId);
  if (subscription.revoked_at) {
    throw new PilotApiError(
      "SUBSCRIPTION_REVOKED",
      "This calendar connection has been revoked.",
      410,
    );
  }

  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await createGoogleOAuthState({
    stateHash: stateHash(state),
    subscriptionId: input.subscriptionId,
    expiresAt,
    env,
  });

  return buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
}

export async function syncGoogleSubscription(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  requireGoogleConfig(env);
  const subscription = asRecord(await getCalendarSubscriptionById(subscriptionId));
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError("SUBSCRIPTION_NOT_FOUND", "Google Calendar setup not found.", 404);
  }
  if (subscription.revoked_at || subscription.status === "disconnected") {
    return { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  }

  const timetableId = String(subscription.timetable_id);
  const timetable = await getPublishedTimetableById(timetableId);
  if (!timetable.publishedAt) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable is not currently published.",
      404,
    );
  }
  const revision = await getCalendarRevision(timetableId, env);
  const resolvedTimetable: PublicTimetable = {
    ...timetable,
    publishedAt: revision.updatedAt,
    versionNumber: revision.sequence,
  };
  const reminders = Array.isArray(subscription.reminder_offsets_minutes)
    ? (subscription.reminder_offsets_minutes as number[])
    : [];
  const projection = projectPublishedTimetable({
    timetable: resolvedTimetable,
    reminderOffsetsMinutes: reminders,
    publicOrigin: env.PUBLIC_APP_URL ?? "https://calender.aido.co.zw",
  });
  const publishedVersionId = await getCurrentPublishedVersionId(timetableId, env);
  if (!publishedVersionId) {
    throw new PilotApiError(
      "TIMETABLE_NOT_PUBLISHED",
      "This timetable is not currently published.",
      404,
    );
  }

  const { accessToken } = await loadAccessToken(subscriptionId, env);
  let calendarId = subscription.external_calendar_id
    ? String(subscription.external_calendar_id)
    : null;
  if (!calendarId) {
    calendarId = await createSecondaryCalendar({
      accessToken,
      calendarName: String(subscription.calendar_name),
      timezone: String(subscription.timezone || timetable.institutionTimezone),
    });
    await updateGoogleSubscription({
      subscriptionId,
      externalCalendarId: calendarId,
      env,
    });
  }

  const previousRecords = await listGoogleEventSyncRecords(subscriptionId, env);
  const previousById = new Map(
    previousRecords.map((row) => [String(row.internal_event_id), row]),
  );
  const nextIds = new Set<string>();
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;

  for (const event of projection.events) {
    nextIds.add(event.stableSessionKey);
    const payload = googleEventPayload({
      timetable: resolvedTimetable,
      event,
      reminders,
    });
    const hash = contentHash(payload);
    const previous = previousById.get(event.stableSessionKey);
    const externalEventId = previous?.external_event_id
      ? String(previous.external_event_id)
      : null;

    if (externalEventId && previous?.content_hash === hash) {
      unchanged += 1;
      continue;
    }

    let remoteEventId = externalEventId;
    if (externalEventId) {
      const result = await googleApiRequest({
        accessToken,
        path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`,
        method: "PUT",
        body: payload,
      });
      remoteEventId = result?.id ? String(result.id) : externalEventId;
      updated += 1;
    } else {
      const result = await googleApiRequest({
        accessToken,
        path: `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
        method: "POST",
        body: payload,
      });
      remoteEventId = result?.id ? String(result.id) : null;
      if (!remoteEventId) {
        throw new PilotApiError(
          "GOOGLE_EVENT_CREATE_FAILED",
          "Google Calendar could not create a timetable event.",
          502,
        );
      }
      created += 1;
    }

    await upsertGoogleEventSyncRecord({
      subscriptionId,
      internalEventId: event.stableSessionKey,
      timetableVersionId: publishedVersionId,
      externalCalendarId: calendarId,
      externalEventId: remoteEventId,
      contentHash: hash,
      syncStatus: "active",
      env,
    });
  }

  for (const previous of previousRecords) {
    const internalEventId = String(previous.internal_event_id);
    if (nextIds.has(internalEventId)) continue;
    const externalEventId = previous.external_event_id
      ? String(previous.external_event_id)
      : null;
    if (externalEventId) {
      await googleApiRequest({
        accessToken,
        path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`,
        method: "DELETE",
        allowMissing: true,
      });
    }
    await deleteGoogleEventSyncRecord({
      subscriptionId,
      internalEventId,
      env,
    });
    deleted += 1;
  }

  const lastSyncedAt = new Date().toISOString();
  await updateGoogleSubscription({
    subscriptionId,
    status: "active",
    externalCalendarId: calendarId,
    syncedTimetableVersionId: publishedVersionId,
    lastSyncedAt,
    lastErrorCode: null,
    env,
  });
  return { created, updated, deleted, unchanged, lastSyncedAt };
}

export async function completeGoogleCalendarConnection(input: {
  code: string;
  state: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  requireGoogleConfig(env);
  const stateRow = await consumeGoogleOAuthState({
    stateHash: stateHash(input.state),
    env,
  });
  if (!stateRow?.subscription_id) {
    throw new PilotApiError(
      "GOOGLE_STATE_INVALID",
      "Google Calendar authorization expired or was already used. Please start again.",
      400,
    );
  }
  if (Date.parse(String(stateRow.expires_at)) <= Date.now()) {
    throw new PilotApiError(
      "GOOGLE_STATE_EXPIRED",
      "Google Calendar authorization expired. Please start again.",
      400,
    );
  }

  const subscriptionId = String(stateRow.subscription_id);
  const subscription = asRecord(await getCalendarSubscriptionById(subscriptionId));
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError("SUBSCRIPTION_NOT_FOUND", "Google Calendar setup not found.", 404);
  }

  const token = await exchangeAuthorizationCode({ code: input.code, env });
  const scope = token.scope || googleCalendarScope;
  if (!scope.split(/\s+/).includes(googleCalendarScope)) {
    throw new PilotApiError(
      "GOOGLE_SCOPE_MISSING",
      "Google did not grant the calendar permission CalenderZW needs.",
      400,
    );
  }

  let refreshToken = token.refresh_token;
  if (!refreshToken) {
    const existing = await getGoogleCredential(subscriptionId, env);
    if (existing?.encrypted_refresh_token) {
      refreshToken = decryptGoogleRefreshToken(
        String(existing.encrypted_refresh_token),
        env,
      );
    }
  }
  if (!refreshToken) {
    throw new PilotApiError(
      "GOOGLE_REFRESH_TOKEN_MISSING",
      "Google did not return long-term calendar access. Please reconnect and approve access.",
      400,
    );
  }

  await saveGoogleCredential({
    subscriptionId,
    encryptedRefreshToken: encryptGoogleRefreshToken(refreshToken, env),
    grantedScope: scope,
    env,
  });

  try {
    await syncGoogleSubscription(subscriptionId, env);
  } catch (error) {
    await updateGoogleSubscription({
      subscriptionId,
      status: "failed",
      lastErrorCode:
        error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
      env,
    });
    throw error;
  }

  const timetable = await getPublishedTimetableById(String(subscription.timetable_id));
  return { subscriptionId, publicSlug: timetable.publicSlug };
}

export async function syncGoogleSubscriptionsForTimetable(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!getPublicGoogleCalendarStatus(env).enabled) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  const subscriptions = await listActiveGoogleSubscriptions(timetableId, env);
  let succeeded = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const subscriptionId = String(subscription.id);
    try {
      await syncGoogleSubscription(subscriptionId, env);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await updateGoogleSubscription({
        subscriptionId,
        lastErrorCode:
          error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
        env,
      }).catch(() => undefined);
      console.warn("Google Calendar sync failed", {
        subscriptionId,
        timetableId,
        code: error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
      });
    }
  }
  return { attempted: subscriptions.length, succeeded, failed };
}

export async function disconnectGoogleCalendar(input: {
  subscriptionId: string;
  anonymousSessionId: string | null;
  deleteCreatedCalendar: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  requireGoogleConfig(env);
  const subscription = asRecord(
    await getCalendarSubscriptionById(input.subscriptionId),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError("SUBSCRIPTION_NOT_FOUND", "Google Calendar setup not found.", 404);
  }
  assertSubscriptionOwner(subscription, input.anonymousSessionId);

  const credential = await getGoogleCredential(input.subscriptionId, env);
  if (credential?.encrypted_refresh_token) {
    const refreshToken = decryptGoogleRefreshToken(
      String(credential.encrypted_refresh_token),
      env,
    );
    if (input.deleteCreatedCalendar && subscription.external_calendar_id) {
      try {
        const accessToken = await refreshAccessToken({ refreshToken, env });
        await googleApiRequest({
          accessToken,
          path: `/calendars/${encodeURIComponent(String(subscription.external_calendar_id))}`,
          method: "DELETE",
          allowMissing: true,
        });
      } catch {
        // Token revocation still proceeds; the user can remove the retained calendar manually.
      }
    }
    await fetch(`${googleRevokeEndpoint}?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  }

  await deleteGoogleCredential(input.subscriptionId, env);
  await updateGoogleSubscription({
    subscriptionId: input.subscriptionId,
    status: "disconnected",
    externalCalendarId: input.deleteCreatedCalendar
      ? null
      : subscription.external_calendar_id
        ? String(subscription.external_calendar_id)
        : null,
    lastErrorCode: null,
    env,
  });
  return { ok: true, deletedCreatedCalendar: input.deleteCreatedCalendar };
}
