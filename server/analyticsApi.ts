import type { IncomingMessage, ServerResponse } from "node:http";
import {
  classifyAnalyticsClient,
  isAnalyticsEventName,
  isAnalyticsUuid,
  sanitizeAnalyticsProperties,
  type AnalyticsEventName,
  type AnalyticsProperties,
} from "../src/domain/analytics.js";
import {
  persistAnalyticsEvents,
  type AnalyticsEventInsert,
} from "./analyticsRepository.js";

const PRODUCT_KEY = "calenderzw";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_BATCH = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 60;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

type ParsedAnalyticsEvent = {
  name: AnalyticsEventName;
  properties: AnalyticsProperties;
  clientTimestamp?: string;
};

type ParsedAnalyticsPayload = {
  productKey: string;
  anonymousId: string;
  sessionId: string;
  events: ParsedAnalyticsEvent[];
};

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

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestIp(req: IncomingMessage) {
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  return forwarded?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

function consumeRateLimit(key: string, now = Date.now()) {
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateBuckets.size > 5000) {
      for (const [bucketKey, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }
    return true;
  }
  if (existing.count >= RATE_LIMIT_REQUESTS) return false;
  existing.count += 1;
  return true;
}

async function readLimitedBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Analytics payload is too large.");
      error.name = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseProperties(input: unknown) {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Analytics event properties must be an object.");
  }
  const inputRecord = input as Record<string, unknown>;
  const sanitized = sanitizeAnalyticsProperties(inputRecord);
  const submittedKeys = Object.keys(inputRecord);
  const acceptedKeys = new Set(Object.keys(sanitized));
  if (submittedKeys.some((key) => !acceptedKeys.has(key))) {
    throw new Error("Analytics event contains unsupported properties.");
  }
  return sanitized;
}

export function parseAnalyticsPayload(input: unknown): ParsedAnalyticsPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Analytics payload must be an object.");
  }
  const payload = input as Record<string, unknown>;
  if (payload.productKey !== PRODUCT_KEY) {
    throw new Error("Unsupported analytics product key.");
  }
  if (!isAnalyticsUuid(payload.anonymousId) || !isAnalyticsUuid(payload.sessionId)) {
    throw new Error("Analytics identity is invalid.");
  }
  if (!Array.isArray(payload.events) || payload.events.length < 1) {
    throw new Error("Analytics events are required.");
  }
  if (payload.events.length > MAX_EVENTS_PER_BATCH) {
    throw new Error("Too many analytics events in one request.");
  }

  const events = payload.events.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Analytics event must be an object.");
    }
    const event = value as Record<string, unknown>;
    if (!isAnalyticsEventName(event.name)) {
      throw new Error("Unsupported analytics event name.");
    }
    let clientTimestamp: string | undefined;
    if (event.clientTimestamp !== undefined) {
      if (typeof event.clientTimestamp !== "string") {
        throw new Error("Analytics event timestamp is invalid.");
      }
      const timestamp = Date.parse(event.clientTimestamp);
      const now = Date.now();
      if (
        Number.isNaN(timestamp) ||
        timestamp > now + 10 * 60_000 ||
        timestamp < now - 7 * 24 * 60 * 60_000
      ) {
        throw new Error("Analytics event timestamp is outside the accepted window.");
      }
      clientTimestamp = new Date(timestamp).toISOString();
    }
    return {
      name: event.name,
      properties: parseProperties(event.properties),
      clientTimestamp,
    };
  });

  return {
    productKey: PRODUCT_KEY,
    anonymousId: payload.anonymousId,
    sessionId: payload.sessionId,
    events,
  };
}

function optionalString(properties: AnalyticsProperties, key: string) {
  const value = properties[key];
  return typeof value === "string" && value ? value : null;
}

export async function handleAnalyticsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    persistEvents?: typeof persistAnalyticsEvents;
  } = {},
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (requestUrl.pathname !== "/api/analytics/events") return false;

  if (req.method !== "POST") {
    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
    return true;
  }

  try {
    const rawBody = await readLimitedBody(req);
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawBody || "{}");
    } catch {
      throw new Error("Analytics payload must be valid JSON.");
    }
    const payload = parseAnalyticsPayload(rawPayload);
    const rateKey = `${requestIp(req)}:${payload.anonymousId}`;
    if (!consumeRateLimit(rateKey)) {
      sendJson(res, 429, {
        error: { code: "RATE_LIMITED", message: "Too many analytics requests." },
      });
      return true;
    }

    const userAgent = headerValue(req.headers["user-agent"]);
    const client = classifyAnalyticsClient(userAgent);
    const rows: AnalyticsEventInsert[] = payload.events.map((event) => ({
      productKey: payload.productKey,
      eventName: event.name,
      anonymousId: payload.anonymousId,
      sessionId: payload.sessionId,
      timetableId: optionalString(event.properties, "timetableId"),
      subscriptionId: optionalString(event.properties, "subscriptionId"),
      publicSlug: optionalString(event.properties, "publicSlug"),
      provider: optionalString(event.properties, "provider"),
      properties: event.properties,
      clientTimestamp: event.clientTimestamp ?? null,
      client,
    }));

    let persisted = true;
    try {
      await (dependencies.persistEvents ?? persistAnalyticsEvents)(rows, env);
    } catch (error) {
      persisted = false;
      console.warn("analytics persistence unavailable", {
        eventCount: rows.length,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    const secure = env.NODE_ENV === "production" ? "; Secure" : "";
    sendJson(
      res,
      202,
      { accepted: rows.length, persisted },
      {
        "Set-Cookie": `calenderzw_anon_session=${payload.anonymousId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`,
      },
    );
  } catch (error) {
    const tooLarge = error instanceof Error && error.name === "PAYLOAD_TOO_LARGE";
    sendJson(res, tooLarge ? 413 : 422, {
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
        message:
          error instanceof Error ? error.message : "Invalid analytics request.",
      },
    });
  }
  return true;
}

export function resetAnalyticsRateLimitsForTests() {
  rateBuckets.clear();
}
