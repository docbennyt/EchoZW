import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { PublicTimetable } from "../src/api/pilotTypes.js";
import {
  googleRecoveryScope,
  googleSubscriptionAllowed,
} from "./googleDeliveryPolicy.js";
import { getCalendarRevision } from "./calendarRevisionRepository.js";
import {
  buildGoogleAuthorizationUrl,
  buildGoogleTokenExchangeBody,
  resolveGoogleOAuthConfig,
} from "../src/domain/googleOAuthConfig.js";
import { googleCalendarScope } from "../src/domain/googleScopes.js";
import { projectPublishedTimetable } from "../src/domain/publishedCalendarProjection.js";
import { loadPublishedTimetableSnapshot } from "./publishedTimetableSnapshot.js";
import {
  budgetedFetch,
  markExternalWorkProgress,
  withExternalRequestBudget,
} from "./externalRequestBudget.js";
import {
  consumeGoogleOAuthState,
  createGoogleOAuthState,
  disconnectGoogleCalendarConnection,
  deleteGoogleEventSyncRecord,
  getGoogleCredential,
  listGoogleEventSyncRecords,
  listSyncableGoogleSubscriptions,
  persistGoogleCalendarConnection,
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

type GoogleManagedRemoteEvent = {
  id: string;
  stableSessionKey: string;
  content: JsonRecord;
};

const googleCalendarApi = "https://www.googleapis.com/calendar/v3";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleRevokeEndpoint = "https://oauth2.googleapis.com/revoke";

function asRecord(value: unknown) {
  return value as JsonRecord;
}

function assertCloudflareDeliveryScope(
  env: NodeJS.ProcessEnv,
  subscription: JsonRecord,
) {
  if (
    env.APP_ENV?.startsWith("cloudflare-") &&
    !googleSubscriptionAllowed(env, subscription)
  ) {
    throw new PilotApiError(
      "GOOGLE_DELIVERY_UNAVAILABLE",
      "Google Calendar delivery is temporarily unavailable.",
      503,
    );
  }
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

// Runtime-only diagnostic: never exchange, return, or persist the plaintext.
export async function checkGoogleCredentialCompatibility(
  subscriptionId: string,
  env: NodeJS.ProcessEnv,
) {
  const credential = await getGoogleCredential(subscriptionId, env);
  if (!credential?.encrypted_refresh_token) {
    throw new PilotApiError(
      "GOOGLE_CREDENTIAL_INVALID",
      "Stored Google Calendar access is unavailable. Please reconnect.",
      409,
    );
  }
  // Check configuration separately so a missing key is not labelled revocation.
  encryptionKey(env);
  const plaintext = decryptGoogleRefreshToken(
    String(credential.encrypted_refresh_token),
    env,
  );
  if (!plaintext.trim()) {
    throw new PilotApiError(
      "GOOGLE_CREDENTIAL_INVALID",
      "Stored Google Calendar access is invalid. Please reconnect.",
      409,
    );
  }
  return {
    readOnly: true,
    credentialPresent: true,
    decryptionCompatible: true,
    formatVersion: "v1",
    providerAuthorizationVerified: false,
  };
}

async function parseGoogleJson(response: Response) {
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    return {};
  }
}

async function googleFetch(url: string, init: RequestInit) {
  const timeout = AbortSignal.timeout(15_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  signal.throwIfAborted();
  try {
    const response = await budgetedFetch(url, {
      ...init,
      redirect: "error",
      signal,
    });
    signal.throwIfAborted();
    return response;
  } catch {
    throw new PilotApiError(
      "GOOGLE_REQUEST_FAILED",
      "Google Calendar could not be reached. Please try again.",
      502,
    );
  }
}

async function googleApiRequest(input: {
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  allowMissing?: boolean;
  signal?: AbortSignal;
}) {
  const response = await googleFetch(`${googleCalendarApi}${input.path}`, {
    signal: input.signal,
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  if (
    input.allowMissing &&
    (response.status === 404 || response.status === 410)
  ) {
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

function getNestedRecord(value: unknown, key: string) {
  const nested = asRecord(value)?.[key];
  return nested && typeof nested === "object" ? asRecord(nested) : null;
}

function googleManagedEventFromItem(
  item: unknown,
  timetableId: string,
): GoogleManagedRemoteEvent | null {
  const record = item && typeof item === "object" ? asRecord(item) : null;
  const id = record?.id ? String(record.id) : null;
  const extendedProperties = getNestedRecord(record, "extendedProperties");
  const privateProperties = getNestedRecord(extendedProperties, "private");
  const itemTimetableId = privateProperties?.calenderzwTimetableId
    ? String(privateProperties.calenderzwTimetableId)
    : null;
  const stableSessionKey = privateProperties?.calenderzwStableSessionKey
    ? String(privateProperties.calenderzwStableSessionKey)
    : null;
  if (!id || itemTimetableId !== timetableId || !stableSessionKey) {
    return null;
  }
  return { id, stableSessionKey, content: record as JsonRecord };
}

async function listRemoteManagedEvents(input: {
  accessToken: string;
  calendarId: string;
  timetableId: string;
  signal?: AbortSignal;
}) {
  const events: GoogleManagedRemoteEvent[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `calenderzwTimetableId=${input.timetableId}`,
      showDeleted: "false",
      singleEvents: "false",
      maxResults: "2500",
      fields:
        "items(id,summary,description,location,start,end,recurrence,reminders,extendedProperties/private),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleApiRequest({
      signal: input.signal,
      accessToken: input.accessToken,
      path: `/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
      method: "GET",
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const event = googleManagedEventFromItem(item, input.timetableId);
      if (event) events.push(event);
    }
    pageToken = data?.nextPageToken ? String(data.nextPageToken) : null;
  } while (pageToken);
  return events;
}

async function readRemoteManagedEvent(input: {
  accessToken: string;
  calendarId: string;
  timetableId: string;
  eventId: string;
  signal?: AbortSignal;
  includeCancelled?: boolean;
}) {
  const item = await googleApiRequest({
    accessToken: input.accessToken,
    path: `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    allowMissing: true,
    signal: input.signal,
  });
  if (!item || (item.status === "cancelled" && !input.includeCancelled))
    return { missing: true, event: null };
  const event = googleManagedEventFromItem(item, input.timetableId);
  return { missing: false, event: event?.id === input.eventId ? event : null };
}

async function verifyRemoteManagedEvents(input: {
  accessToken: string;
  calendarId: string;
  timetableId: string;
  previousRecords: JsonRecord[];
  listedEvents: GoogleManagedRemoteEvent[];
  signal?: AbortSignal;
  deferMissingMappings?: boolean;
}) {
  const expectedKeys = new Map<string, Set<string>>();
  for (const event of input.listedEvents) {
    expectedKeys.set(event.id, new Set([event.stableSessionKey]));
  }
  for (const row of input.previousRecords) {
    if (!row.external_event_id) continue;
    const id = String(row.external_event_id);
    const keys = expectedKeys.get(id) ?? new Set<string>();
    keys.add(String(row.internal_event_id));
    expectedKeys.set(id, keys);
  }
  const events: GoogleManagedRemoteEvent[] = [];
  const ownershipReviewIds = new Set<string>();
  const listedById = new Map(
    input.listedEvents.map((event) => [event.id, event]),
  );
  for (const [eventId, keys] of expectedKeys) {
    if (keys.size !== 1) {
      ownershipReviewIds.add(eventId);
      continue;
    }
    if (input.deferMissingMappings) {
      const listed = listedById.get(eventId);
      if (!listed) continue;
      if (keys.size !== 1 || !keys.has(listed.stableSessionKey))
        ownershipReviewIds.add(eventId);
      else events.push(listed);
      continue;
    }
    const result = await readRemoteManagedEvent({ ...input, eventId });
    if (result.missing) continue;
    if (
      !result.event ||
      keys.size !== 1 ||
      !keys.has(result.event.stableSessionKey)
    ) {
      ownershipReviewIds.add(eventId);
      continue;
    }
    events.push(result.event);
  }
  return { events, ownershipReviewIds };
}

function newGoogleEventId(input: {
  subscriptionId: string;
  timetableId: string;
  calendarId: string;
  stableSessionKey: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.subscriptionId,
        input.timetableId,
        input.calendarId,
        input.stableSessionKey,
      ]),
      "utf8",
    )
    .digest("hex");
}

async function exchangeAuthorizationCode(input: {
  code: string;
  env: NodeJS.ProcessEnv;
}) {
  const config = requireGoogleConfig(input.env);
  const response = await googleFetch(googleTokenEndpoint, {
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
  signal?: AbortSignal;
}) {
  const config = requireGoogleConfig(input.env);
  const response = await googleFetch(googleTokenEndpoint, {
    signal: input.signal,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await parseGoogleJson(response)) as GoogleTokenResponse & {
    error?: string;
  };
  if (response.status === 400 && body.error === "invalid_grant") {
    throw new PilotApiError(
      "GOOGLE_CREDENTIAL_INVALID",
      "Google Calendar access is no longer valid. Please reconnect.",
      409,
    );
  }
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
      overrides: [
        ...new Set(
          event.eventCategory === "exam"
            ? event.alarms.map((alarm) => alarm.minutesBefore)
            : input.reminders,
        ),
      ]
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

function remotePayloadMatches(
  remote: JsonRecord,
  expected: GoogleEventPayload,
  onMismatch?: (field: string) => void,
) {
  const normalize = (value: JsonRecord) => {
    const start = getNestedRecord(value, "start");
    const end = getNestedRecord(value, "end");
    const reminders = getNestedRecord(value, "reminders");
    const overrides = Array.isArray(reminders?.overrides)
      ? reminders.overrides
      : [];
    return {
      summary: value.summary ?? "",
      description: value.description ?? "",
      location: value.location ?? "",
      start: Date.parse(String(start?.dateTime)),
      end: Date.parse(String(end?.dateTime)),
      startZone: start?.timeZone,
      endZone: end?.timeZone,
      recurrence: [
        ...(Array.isArray(value.recurrence) ? value.recurrence : []),
      ].sort(),
      useDefault: reminders?.useDefault === true,
      overrides: overrides
        .map((item) => {
          const row = asRecord(item);
          return `${row.method}:${row.minutes}`;
        })
        .sort(),
    };
  };
  const actual = normalize(remote);
  const desired = normalize(expected as unknown as JsonRecord);
  const fields = (Object.keys(actual) as Array<keyof typeof actual>).filter(
    (field) => JSON.stringify(actual[field]) !== JSON.stringify(desired[field]),
  );
  for (const field of fields) onMismatch?.(field);
  return fields.length === 0;
}

function hasRemoteContent(event: GoogleManagedRemoteEvent) {
  return Boolean(
    Number.isFinite(
      Date.parse(String(getNestedRecord(event.content, "start")?.dateTime)),
    ) &&
    Number.isFinite(
      Date.parse(String(getNestedRecord(event.content, "end")?.dateTime)),
    ),
  );
}

async function createSecondaryCalendar(input: {
  accessToken: string;
  calendarName: string;
  timezone: string;
  signal?: AbortSignal;
}) {
  const data = await googleApiRequest({
    signal: input.signal,
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
  signal?: AbortSignal,
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
    accessToken: await refreshAccessToken({ refreshToken, env, signal }),
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
    await getCalendarSubscriptionById(input.subscriptionId, env),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "We could not find this Google Calendar setup.",
      404,
    );
  }
  assertSubscriptionOwner(subscription, input.anonymousSessionId);
  assertCloudflareDeliveryScope(env, subscription);
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
    anonymousSessionId: input.anonymousSessionId,
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
  options: { signal?: AbortSignal; maxExternalRequests?: number } = {},
) {
  const work = () => reconcileGoogleSubscription(subscriptionId, env, options);
  return options.maxExternalRequests === undefined
    ? work()
    : withExternalRequestBudget(options.maxExternalRequests, work);
}

async function reconcileGoogleSubscription(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { signal?: AbortSignal; maxExternalRequests?: number } = {},
) {
  const { signal } = options;
  signal?.throwIfAborted();
  requireGoogleConfig(env);
  const subscription = asRecord(
    await getCalendarSubscriptionById(subscriptionId, env),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  }
  if (subscription.revoked_at || subscription.status === "disconnected") {
    return { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  }
  assertCloudflareDeliveryScope(env, subscription);
  const recovery = googleRecoveryScope(env);
  const recoveryScope =
    recovery?.subscription === subscriptionId ? recovery : null;
  if (recoveryScope && !subscription.external_calendar_id)
    throw new PilotApiError(
      "GOOGLE_RECOVERY_MUTATION_FORBIDDEN",
      "Recovery requires an existing calendar.",
      409,
    );

  const connectionGeneration = Number(
    subscription.google_connection_generation ?? 0,
  );
  const assertConnection = async () => {
    assertCloudflareDeliveryScope(env, subscription);
    if (recoveryScope) {
      const current = await getCalendarRevision(
        String(subscription.timetable_id),
        env,
      );
      if (current.sequence !== recoveryScope.revision)
        throw new PilotApiError(
          "GOOGLE_RECOVERY_REVISION_CHANGED",
          "The published schedule changed. Preview recovery again.",
          409,
        );
    }
    const accepted = await updateGoogleSubscription({
      subscriptionId,
      connectionGeneration,
      env,
    });
    if (!accepted)
      throw new PilotApiError(
        "GOOGLE_CONNECTION_CHANGED",
        "Google Calendar connection changed during synchronization.",
        409,
      );
  };
  const writeGoogleEvent = async (
    input: Parameters<typeof googleApiRequest>[0],
  ) => {
    if (recoveryScope && (input.method === "POST" || input.method === "DELETE"))
      throw new PilotApiError(
        "GOOGLE_RECOVERY_MUTATION_FORBIDDEN",
        "This recovery permits existing event updates only.",
        409,
      );
    await assertConnection();
    const result = await googleApiRequest(input);
    if (recoveryScope)
      console.log(
        JSON.stringify({
          event: "google.delivery.provider_mutation_accepted",
          operation: "update",
          sourceSha: env.SOURCE_SHA,
          revision: recoveryScope.revision,
        }),
      );
    return result;
  };

  const timetableId = String(subscription.timetable_id);
  const { timetable, revision } = await loadPublishedTimetableSnapshot(
    timetableId,
    env,
  );
  if (recoveryScope && revision.sequence !== recoveryScope.revision)
    throw new PilotApiError(
      "GOOGLE_RECOVERY_REVISION_CHANGED",
      "The published schedule changed. Preview recovery again.",
      409,
    );
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
    examReminderOffsetsMinutes: Array.isArray(
      subscription.exam_reminder_offsets_minutes,
    )
      ? (subscription.exam_reminder_offsets_minutes as number[])
      : [],
    publicOrigin: env.PUBLIC_APP_URL ?? "https://calender.aido.co.zw",
  });
  const publishedVersionId = revision.publishedVersionId;

  const { accessToken } = await loadAccessToken(subscriptionId, env, signal);
  let calendarId = subscription.external_calendar_id
    ? String(subscription.external_calendar_id)
    : null;
  if (!calendarId) {
    await assertConnection();
    calendarId = await createSecondaryCalendar({
      signal,
      accessToken,
      calendarName: String(subscription.calendar_name),
      timezone: String(subscription.timezone || timetable.institutionTimezone),
    });
    signal?.throwIfAborted();
    const accepted = await updateGoogleSubscription({
      subscriptionId,
      externalCalendarId: calendarId,
      connectionGeneration,
      env,
    });
    if (!accepted)
      throw new PilotApiError(
        "GOOGLE_CONNECTION_CHANGED",
        "Google Calendar connection changed during synchronization.",
        409,
      );
  }

  const previousRecords = await listGoogleEventSyncRecords(subscriptionId, env);
  const previousById = new Map(
    previousRecords.map((row) => [String(row.internal_event_id), row]),
  );
  const listedEvents = await listRemoteManagedEvents({
    signal,
    accessToken,
    calendarId,
    timetableId,
  });
  const { events: remoteManagedEvents, ownershipReviewIds } =
    await verifyRemoteManagedEvents({
      signal,
      accessToken,
      calendarId,
      timetableId,
      previousRecords,
      listedEvents,
      deferMissingMappings: options.maxExternalRequests !== undefined,
    });
  const remoteManagedByStableKey = new Map<
    string,
    GoogleManagedRemoteEvent[]
  >();
  for (const event of remoteManagedEvents) {
    remoteManagedByStableKey.set(event.stableSessionKey, [
      ...(remoteManagedByStableKey.get(event.stableSessionKey) ?? []),
      event,
    ]);
  }
  const remoteManagedEventKeysById = new Map(
    remoteManagedEvents.map((event) => [event.id, event.stableSessionKey]),
  );
  // Fresh list results already prove ownership. Resolve absent/stale mapped IDs
  // lazily so bounded retries can advance instead of repeating an unbounded read phase.
  const verifyMissingMapping = async (previous: JsonRecord | undefined) => {
    const id = previous?.external_event_id
      ? String(previous.external_event_id)
      : null;
    if (
      options.maxExternalRequests === undefined ||
      !id ||
      remoteManagedEventKeysById.has(id) ||
      ownershipReviewIds.has(id)
    )
      return;
    const result = await readRemoteManagedEvent({
      signal,
      accessToken,
      calendarId,
      timetableId,
      eventId: id,
    });
    if (result.missing) return;
    if (
      !result.event ||
      result.event.stableSessionKey !== String(previous?.internal_event_id)
    ) {
      ownershipReviewIds.add(id);
      return;
    }
    const event = result.event;
    remoteManagedEvents.push(event);
    remoteManagedEventKeysById.set(event.id, event.stableSessionKey);
    remoteManagedByStableKey.set(event.stableSessionKey, [
      ...(remoteManagedByStableKey.get(event.stableSessionKey) ?? []),
      event,
    ]);
  };
  const nextIds = new Set<string>();
  const retainedRemoteEventIds = new Set<string>();
  const deletedRemoteEventIds = new Set<string>();
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;

  for (const event of projection.events) {
    signal?.throwIfAborted();
    nextIds.add(event.stableSessionKey);
    const payload = googleEventPayload({
      timetable: resolvedTimetable,
      event,
      reminders,
    });
    const hash = contentHash(payload);
    const previous = previousById.get(event.stableSessionKey);
    await verifyMissingMapping(previous);
    const remoteMatches = remoteManagedByStableKey.get(event.stableSessionKey);
    const previousExternalEventId = previous?.external_event_id
      ? String(previous.external_event_id)
      : null;
    if (
      previousExternalEventId &&
      ownershipReviewIds.has(previousExternalEventId)
    ) {
      for (const match of remoteMatches ?? [])
        retainedRemoteEventIds.add(match.id);
      continue;
    }
    const previousRemoteStillManaged = previousExternalEventId
      ? remoteManagedEventKeysById.get(previousExternalEventId) ===
        event.stableSessionKey
      : false;
    const externalEventId = previousRemoteStillManaged
      ? previousExternalEventId
      : (remoteMatches?.[0]?.id ?? null);

    if (
      externalEventId &&
      externalEventId === previousExternalEventId &&
      previousRemoteStillManaged &&
      previous?.content_hash === hash &&
      (!recoveryScope ||
        remotePayloadMatches(
          remoteManagedEvents.find((item) => item.id === externalEventId)
            ?.content ?? {},
          payload,
        ))
    ) {
      retainedRemoteEventIds.add(externalEventId);
      unchanged += 1;
      continue;
    }

    let remoteEventId: string;
    if (externalEventId) {
      const result = await writeGoogleEvent({
        signal,
        accessToken,
        path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`,
        method: "PUT",
        body: payload,
      });
      remoteEventId = result?.id ? String(result.id) : externalEventId;
      updated += 1;
    } else {
      const id = newGoogleEventId({
        subscriptionId,
        timetableId,
        calendarId,
        stableSessionKey: event.stableSessionKey,
      });
      let result: JsonRecord | null;
      try {
        result = await writeGoogleEvent({
          signal,
          accessToken,
          path: `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
          method: "POST",
          body: { ...payload, id },
        });
        created += 1;
      } catch (error) {
        if (
          !(error instanceof PilotApiError) ||
          asRecord(error.details)?.status !== 409
        )
          throw error;
        const existing = await readRemoteManagedEvent({
          signal,
          accessToken,
          calendarId,
          timetableId,
          eventId: id,
          includeCancelled: true,
        });
        if (
          !existing.event ||
          existing.event.stableSessionKey !== event.stableSessionKey
        ) {
          throw new PilotApiError(
            "GOOGLE_EVENT_OWNERSHIP_CONFLICT",
            "A Google Calendar event requires ownership review.",
            409,
          );
        }
        result = await writeGoogleEvent({
          signal,
          accessToken,
          path: `/calendars/${encodeURIComponent(calendarId)}/events/${id}?sendUpdates=none`,
          method: "PUT",
          body: { ...payload, status: "confirmed" },
        });
        updated += 1;
      }
      const createdEventId = result?.id ? String(result.id) : null;
      if (!createdEventId) {
        throw new PilotApiError(
          "GOOGLE_EVENT_CREATE_FAILED",
          "Google Calendar could not create a timetable event.",
          502,
        );
      }
      remoteEventId = createdEventId;
    }
    retainedRemoteEventIds.add(remoteEventId);

    signal?.throwIfAborted();
    await upsertGoogleEventSyncRecord({
      subscriptionId,
      connectionGeneration,
      internalEventId: event.stableSessionKey,
      timetableVersionId: publishedVersionId,
      externalCalendarId: calendarId,
      externalEventId: remoteEventId,
      contentHash: hash,
      syncStatus: "active",
      env,
    });
    markExternalWorkProgress();
  }

  for (const previous of previousRecords) {
    signal?.throwIfAborted();
    const internalEventId = String(previous.internal_event_id);
    if (nextIds.has(internalEventId)) continue;
    await verifyMissingMapping(previous);
    const externalEventId = previous.external_event_id
      ? String(previous.external_event_id)
      : null;
    if (externalEventId && ownershipReviewIds.has(externalEventId)) continue;
    if (
      externalEventId &&
      remoteManagedEventKeysById.get(externalEventId) === internalEventId
    ) {
      await writeGoogleEvent({
        signal,
        accessToken,
        path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`,
        method: "DELETE",
        allowMissing: true,
      });
      deletedRemoteEventIds.add(externalEventId);
      deleted += 1;
    }
    await deleteGoogleEventSyncRecord({
      subscriptionId,
      connectionGeneration,
      internalEventId,
      env,
    });
    markExternalWorkProgress();
  }

  for (const event of remoteManagedEvents) {
    signal?.throwIfAborted();
    if (retainedRemoteEventIds.has(event.id)) continue;
    if (deletedRemoteEventIds.has(event.id)) continue;
    await writeGoogleEvent({
      signal,
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}?sendUpdates=none`,
      method: "DELETE",
      allowMissing: true,
    });
    deletedRemoteEventIds.add(event.id);
    deleted += 1;
    markExternalWorkProgress();
  }

  signal?.throwIfAborted();
  const lastSyncedAt = new Date().toISOString();
  const accepted = await updateGoogleSubscription({
    subscriptionId,
    connectionGeneration,
    status: ownershipReviewIds.size ? "failed" : "active",
    externalCalendarId: calendarId,
    syncedTimetableVersionId: publishedVersionId,
    lastSyncedAt,
    lastErrorCode: ownershipReviewIds.size
      ? "GOOGLE_EVENT_OWNERSHIP_REVIEW"
      : null,
    env,
  });
  if (!accepted)
    throw new PilotApiError(
      "GOOGLE_CONNECTION_CHANGED",
      "Google Calendar connection changed during synchronization.",
      409,
    );
  return {
    created,
    updated,
    deleted,
    unchanged,
    ownershipReviewCount: ownershipReviewIds.size,
    lastSyncedAt,
  };
}

export async function previewGoogleSubscriptionSync(
  subscriptionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  requireGoogleConfig(env);
  const subscription = asRecord(
    await getCalendarSubscriptionById(subscriptionId, env),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  }
  if (subscription.revoked_at || subscription.status === "disconnected") {
    return {
      subscriptionId,
      readOnly: true,
      skipped: true,
      reason: "disconnected",
      expectedEvents: 0,
      remoteManagedEvents: 0,
      localMappings: 0,
      wouldCreate: 0,
      wouldUpdate: 0,
      wouldDelete: 0,
      unchanged: 0,
    };
  }

  const timetableId = String(subscription.timetable_id);
  const { timetable, revision } = await loadPublishedTimetableSnapshot(
    timetableId,
    env,
  );
  const calendarId = subscription.external_calendar_id
    ? String(subscription.external_calendar_id)
    : null;
  if (!calendarId) {
    return {
      subscriptionId,
      readOnly: true,
      skipped: true,
      reason: "calendar_not_created",
      expectedEvents: 0,
      remoteManagedEvents: 0,
      localMappings: 0,
      wouldCreate: 0,
      wouldUpdate: 0,
      wouldDelete: 0,
      unchanged: 0,
    };
  }

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
    examReminderOffsetsMinutes: Array.isArray(
      subscription.exam_reminder_offsets_minutes,
    )
      ? (subscription.exam_reminder_offsets_minutes as number[])
      : [],
    publicOrigin: env.PUBLIC_APP_URL ?? "https://calender.aido.co.zw",
  });
  const { accessToken } = await loadAccessToken(subscriptionId, env);
  const previousRecords = await listGoogleEventSyncRecords(subscriptionId, env);
  const previousById = new Map(
    previousRecords.map((row) => [String(row.internal_event_id), row]),
  );
  const listedEvents = await listRemoteManagedEvents({
    accessToken,
    calendarId,
    timetableId,
  });
  const { events: remoteManagedEvents, ownershipReviewIds } =
    await verifyRemoteManagedEvents({
      accessToken,
      calendarId,
      timetableId,
      previousRecords,
      listedEvents,
    });
  const remoteManagedByStableKey = new Map<
    string,
    GoogleManagedRemoteEvent[]
  >();
  for (const event of remoteManagedEvents) {
    remoteManagedByStableKey.set(event.stableSessionKey, [
      ...(remoteManagedByStableKey.get(event.stableSessionKey) ?? []),
      event,
    ]);
  }
  const remoteManagedEventKeysById = new Map(
    remoteManagedEvents.map((event) => [event.id, event.stableSessionKey]),
  );
  const nextIds = new Set<string>();
  const retainedRemoteEventIds = new Set<string>();
  const wouldDeleteRemoteEventIds = new Set<string>();
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldDelete = 0;
  let unchanged = 0;
  let remoteContentMismatchCount = 0;
  // Fixed field names and aggregate counters only, never provider event values.
  const remoteContentMismatchFields: Record<string, number> = {};
  const remoteReadComplete = remoteManagedEvents.every(hasRemoteContent);
  const remoteById = new Map(
    remoteManagedEvents.map((item) => [item.id, item]),
  );

  for (const event of projection.events) {
    nextIds.add(event.stableSessionKey);
    const payload = googleEventPayload({
      timetable: resolvedTimetable,
      event,
      reminders,
    });
    const hash = contentHash(payload);
    const previous = previousById.get(event.stableSessionKey);
    const previousExternalEventId = previous?.external_event_id
      ? String(previous.external_event_id)
      : null;
    const remoteMatches = remoteManagedByStableKey.get(event.stableSessionKey);
    if (
      previousExternalEventId &&
      ownershipReviewIds.has(previousExternalEventId)
    ) {
      for (const match of remoteMatches ?? [])
        retainedRemoteEventIds.add(match.id);
      continue;
    }
    const previousRemoteStillManaged = previousExternalEventId
      ? remoteManagedEventKeysById.get(previousExternalEventId) ===
        event.stableSessionKey
      : false;
    const externalEventId = previousRemoteStillManaged
      ? previousExternalEventId
      : (remoteMatches?.[0]?.id ?? null);

    const remote = externalEventId
      ? remoteById.get(externalEventId)
      : undefined;
    const contentMatches = Boolean(
      remote &&
      hasRemoteContent(remote) &&
      remotePayloadMatches(remote.content, payload, (field) => {
        remoteContentMismatchFields[field] =
          (remoteContentMismatchFields[field] ?? 0) + 1;
      }),
    );
    if (!contentMatches) remoteContentMismatchCount += 1;
    if (
      externalEventId &&
      externalEventId === previousExternalEventId &&
      previousRemoteStillManaged &&
      previous?.content_hash === hash &&
      (!remote || !hasRemoteContent(remote) || contentMatches)
    ) {
      retainedRemoteEventIds.add(externalEventId);
      unchanged += 1;
    } else if (externalEventId) {
      retainedRemoteEventIds.add(externalEventId);
      wouldUpdate += 1;
    } else {
      wouldCreate += 1;
    }
  }

  for (const previous of previousRecords) {
    const internalEventId = String(previous.internal_event_id);
    if (nextIds.has(internalEventId)) continue;
    const externalEventId = previous.external_event_id
      ? String(previous.external_event_id)
      : null;
    if (
      externalEventId &&
      remoteManagedEventKeysById.get(externalEventId) === internalEventId
    ) {
      wouldDeleteRemoteEventIds.add(externalEventId);
      wouldDelete += 1;
    }
  }

  for (const event of remoteManagedEvents) {
    if (retainedRemoteEventIds.has(event.id)) continue;
    if (wouldDeleteRemoteEventIds.has(event.id)) continue;
    wouldDeleteRemoteEventIds.add(event.id);
    wouldDelete += 1;
  }

  // These deletion candidates were actually found in Google with matching
  // timetable ownership tags. A local mapping alone does not prove that a
  // remote calendar event is safe to delete.
  const remoteManagedDeletionCandidates = remoteManagedEvents
    .filter((event) => !retainedRemoteEventIds.has(event.id))
    .map((event) => ({
      stableSessionKey: event.stableSessionKey,
      externalEventId: event.id,
    }))
    .sort(
      (a, b) =>
        a.stableSessionKey.localeCompare(b.stableSessionKey) ||
        a.externalEventId.localeCompare(b.externalEventId),
    );

  return {
    subscriptionId,
    timetableId,
    readOnly: true,
    ownershipReviewCount: ownershipReviewIds.size,
    publishedRevision: revision.sequence,
    connectionGeneration: Number(
      subscription.google_connection_generation ?? 0,
    ),
    remoteReadComplete,
    remoteContentMismatchCount,
    remoteContentMismatchFields,
    remoteContentsVerified:
      remoteReadComplete &&
      remoteContentMismatchCount === 0 &&
      remoteManagedEvents.length === projection.events.length &&
      ownershipReviewIds.size === 0 &&
      wouldCreate === 0 &&
      wouldDelete === 0,
    executionGuard: remoteReadComplete
      ? {
          revision: revision.sequence,
          connectionGeneration: Number(
            subscription.google_connection_generation ?? 0,
          ),
          maxCreates: 0,
          maxDeletes: 0,
        }
      : undefined,
    remoteManagedDeletionCandidates,
    expectedEvents: projection.events.length,
    remoteManagedEvents: remoteManagedEvents.length,
    localMappings: previousRecords.length,
    wouldCreate,
    wouldUpdate,
    wouldDelete,
    unchanged,
  };
}

export async function completeGoogleCalendarConnection(input: {
  code: string;
  state: string;
  env?: NodeJS.ProcessEnv;
  enqueueInitialSync?: (
    target: { subscriptionId: string; timetableId: string },
    env: NodeJS.ProcessEnv,
  ) => Promise<void>;
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
  const expiresAt = Date.parse(String(stateRow.expires_at));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new PilotApiError(
      "GOOGLE_STATE_EXPIRED",
      "Google Calendar authorization expired. Please start again.",
      400,
    );
  }

  const subscriptionId = String(stateRow.subscription_id);
  const subscription = asRecord(
    await getCalendarSubscriptionById(subscriptionId, env),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  }

  if (subscription.revoked_at) {
    throw new PilotApiError(
      "SUBSCRIPTION_REVOKED",
      "This calendar connection has been revoked.",
      410,
    );
  }
  if (subscription.status === "disconnected") {
    throw new PilotApiError(
      "SUBSCRIPTION_DISCONNECTED",
      "This calendar connection is disconnected. Please start again.",
      409,
    );
  }

  assertCloudflareDeliveryScope(env, subscription);
  if (
    env.APP_ENV === "cloudflare-staging" &&
    env.ENABLE_GOOGLE_DELIVERY !== "true" &&
    stateRow.anonymous_session_id !== subscription.anonymous_session_id
  ) {
    throw new PilotApiError(
      "GOOGLE_STATE_INVALID",
      "Google Calendar authorization expired. Please start again.",
      400,
    );
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

  const connectionGeneration = Number(stateRow.connection_generation ?? 0);
  await persistGoogleCalendarConnection({
    subscriptionId,
    connectionGeneration,
    encryptedRefreshToken: encryptGoogleRefreshToken(refreshToken, env),
    grantedScope: scope,
    env,
  });

  try {
    if (input.enqueueInitialSync) {
      await input.enqueueInitialSync(
        { subscriptionId, timetableId: String(subscription.timetable_id) },
        env,
      );
    } else {
      await syncGoogleSubscription(subscriptionId, env);
    }
  } catch (error) {
    await updateGoogleSubscription({
      subscriptionId,
      status: "failed",
      connectionGeneration,
      lastErrorCode:
        error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
      env,
    });
    throw error;
  }

  const timetable = await getPublishedTimetableById(
    String(subscription.timetable_id),
    env,
  );
  return { subscriptionId, publicSlug: timetable.publicSlug };
}

export async function syncGoogleSubscriptionsForTimetable(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!getPublicGoogleCalendarStatus(env).enabled) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  const subscriptions = (
    await listSyncableGoogleSubscriptions(timetableId, env)
  ).filter(
    (row) =>
      !env.APP_ENV?.startsWith("cloudflare-") ||
      googleSubscriptionAllowed(env, row),
  );
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
        connectionGeneration: Number(
          subscription.google_connection_generation ?? 0,
        ),
        status: "failed",
        lastErrorCode:
          error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
        env,
      }).catch(() => undefined);
      console.warn("Google Calendar sync failed", {
        subscriptionId,
        timetableId,
        code:
          error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
      });
    }
  }
  return { attempted: subscriptions.length, succeeded, failed };
}

export async function previewGoogleSubscriptionsForTimetable(
  timetableId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!getPublicGoogleCalendarStatus(env).enabled) {
    return { attempted: 0, succeeded: 0, failed: 0, readOnly: true };
  }
  const subscriptions = await listSyncableGoogleSubscriptions(timetableId, env);
  const previews: unknown[] = [];
  let succeeded = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const subscriptionId = String(subscription.id);
    try {
      previews.push(await previewGoogleSubscriptionSync(subscriptionId, env));
      succeeded += 1;
    } catch (error) {
      failed += 1;
      previews.push({
        subscriptionId,
        readOnly: true,
        failed: true,
        code:
          error instanceof PilotApiError ? error.code : "GOOGLE_SYNC_FAILED",
      });
    }
  }
  return {
    attempted: subscriptions.length,
    succeeded,
    failed,
    readOnly: true,
    previews,
  };
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
    await getCalendarSubscriptionById(input.subscriptionId, env),
  );
  if (!subscription?.id || subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  }
  assertSubscriptionOwner(subscription, input.anonymousSessionId);

  if (input.deleteCreatedCalendar) {
    throw new PilotApiError(
      "GOOGLE_CALENDAR_CLEANUP_UNAVAILABLE",
      "Calendar removal is temporarily unavailable. Disconnect while retaining the calendar, then remove it manually.",
      503,
    );
  }
  const credential = await disconnectGoogleCalendarConnection({
    ...input,
    env,
  });
  let providerRevocation: "confirmed" | "unverified" = "unverified";
  if (credential?.encrypted_refresh_token) {
    let refreshToken: string;
    try {
      refreshToken = decryptGoogleRefreshToken(
        String(credential.encrypted_refresh_token),
        env,
      );
    } catch {
      return { ok: true, deletedCreatedCalendar: false, providerRevocation };
    }
    const revoked = await googleFetch(googleRevokeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => null);
    if (revoked?.ok) providerRevocation = "confirmed";
  }

  return {
    ok: true,
    deletedCreatedCalendar: false,
    providerRevocation,
  };
}
