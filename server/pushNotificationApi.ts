import type { IncomingMessage, ServerResponse } from "node:http";
import { publicWebPushConfig } from "./pushConfig.js";
import {
  getPushSubscriptionStatus,
  PushNotificationRepositoryError,
  revokePushSubscription,
  type PushPlatform,
  upsertPushSubscription,
} from "./pushNotificationRepository.js";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestIp(req: IncomingMessage) {
  return (
    headerValue(req.headers["x-forwarded-for"])?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function consumeRateLimit(key: string, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return false;
  current.count += 1;
  return true;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_INPUT");
  }
  return value as Record<string, unknown>;
}

function cleanSlug(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_INPUT");
  const slug = value.trim();
  if (!slug || slug.length > 180 || !/^[A-Za-z0-9_-]+$/.test(slug)) {
    throw new Error("INVALID_INPUT");
  }
  return slug;
}

function cleanEndpoint(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_INPUT");
  const endpoint = value.trim();
  if (endpoint.length < 8 || endpoint.length > 4096) {
    throw new Error("INVALID_INPUT");
  }
  try {
    if (new URL(endpoint).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("INVALID_INPUT");
  }
  return endpoint;
}

function cleanKey(value: unknown, min: number, max: number) {
  if (typeof value !== "string") throw new Error("INVALID_INPUT");
  const key = value.trim();
  if (key.length < min || key.length > max || !base64UrlPattern.test(key)) {
    throw new Error("INVALID_INPUT");
  }
  return key;
}

function cleanPlatform(value: unknown): PushPlatform {
  const platform = String(value ?? "unknown");
  if (!["android", "ios", "desktop", "unknown"].includes(platform)) {
    throw new Error("INVALID_INPUT");
  }
  return platform as PushPlatform;
}

function parseTargetIdentity(value: unknown) {
  const input = record(value);
  return {
    publicSlug: cleanSlug(input.publicSlug),
    endpoint: cleanEndpoint(input.endpoint),
  };
}

function parseSubscription(value: unknown) {
  const input = record(value);
  const serialized = record(input.subscription);
  const keys = record(serialized.keys);
  return {
    publicSlug: cleanSlug(input.publicSlug),
    endpoint: cleanEndpoint(serialized.endpoint),
    p256dh: cleanKey(keys.p256dh, 8, 1024),
    authSecret: cleanKey(keys.auth, 4, 512),
    platform: cleanPlatform(input.platform),
  };
}

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof PushNotificationRepositoryError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "PAYLOAD_TOO_LARGE") {
    sendJson(res, 413, {
      error: { code, message: "That request is too large." },
    });
    return;
  }
  if (code === "INVALID_JSON" || code === "INVALID_INPUT") {
    sendJson(res, 400, {
      error: { code: "INVALID_INPUT", message: "Invalid push alert request." },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not update timetable alerts. Please try again.",
    },
  });
}

export async function handlePushNotificationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname === "/api/public/push/config") {
    if (req.method !== "GET") {
      sendJson(res, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
      });
      return true;
    }
    try {
      sendJson(res, 200, publicWebPushConfig(env));
    } catch {
      sendJson(res, 503, { enabled: false });
    }
    return true;
  }

  const kind =
    pathname === "/api/public/push/subscriptions/status"
      ? "status"
      : pathname === "/api/public/push/subscriptions"
        ? "subscription"
        : null;
  if (!kind) return false;

  if (!consumeRateLimit(`${requestIp(req)}:${kind}`)) {
    sendJson(res, 429, {
      error: {
        code: "RATE_LIMITED",
        message: "Too many alert requests. Please try again shortly.",
      },
    });
    return true;
  }

  if (kind === "status" && req.method !== "POST") {
    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
    return true;
  }
  if (
    kind === "subscription" &&
    req.method !== "POST" &&
    req.method !== "DELETE"
  ) {
    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
    return true;
  }

  try {
    const body = await readBody(req);
    if (kind === "status") {
      const result = await getPushSubscriptionStatus(
        parseTargetIdentity(body),
        env,
      );
      if (!result.foundTimetable) {
        sendJson(res, 404, {
          error: {
            code: "TIMETABLE_NOT_FOUND",
            message: "Published timetable not found.",
          },
        });
      } else {
        sendJson(res, 200, { active: result.active });
      }
      return true;
    }

    if (req.method === "DELETE") {
      const result = await revokePushSubscription(
        parseTargetIdentity(body),
        env,
      );
      if (!result.foundTimetable) {
        sendJson(res, 404, {
          error: {
            code: "TIMETABLE_NOT_FOUND",
            message: "Published timetable not found.",
          },
        });
      } else {
        sendJson(res, 200, { active: false, revoked: result.revoked });
      }
      return true;
    }

    const config = publicWebPushConfig(env);
    if (!config.enabled) {
      sendJson(res, 503, {
        error: {
          code: "PUSH_PROVIDER_UNAVAILABLE",
          message: "Timetable alerts are temporarily unavailable.",
        },
      });
      return true;
    }
    const created = await upsertPushSubscription(parseSubscription(body), env);
    sendJson(res, 200, {
      active: true,
      subscriptionId: created.id,
    });
  } catch (error) {
    sendError(res, error);
  }
  return true;
}
