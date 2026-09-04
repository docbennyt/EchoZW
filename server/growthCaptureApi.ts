import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createProductFeedback,
  createTimetableRequest,
  type FeedbackInsert,
  type TimetableRequestInsert,
} from "./growthCaptureRepository.js";

const MAX_BODY_BYTES = 24 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 12;
const buckets = new Map<string, { count: number; resetAt: number }>();

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
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function cleanText(value: unknown, max: number, required = false) {
  if (typeof value !== "string") {
    if (required) throw new Error("INVALID_INPUT");
    return null;
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    if (required) throw new Error("INVALID_INPUT");
    return null;
  }
  if (cleaned.length > max) throw new Error("INVALID_INPUT");
  return cleaned;
}

function cleanEmail(value: unknown) {
  const email = cleanText(value, 254);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_INPUT");
  return email.toLowerCase();
}

function cleanPhone(value: unknown) {
  const phone = cleanText(value, 32);
  if (!phone) return null;
  const normalized = phone.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) throw new Error("INVALID_INPUT");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

function parseTimetableRequest(value: unknown): TimetableRequestInsert {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_INPUT");
  const input = value as Record<string, unknown>;
  const requesterRole = input.requesterRole;
  const sourceAccess = input.sourceAccess;
  if (!['student','class_rep','staff','other'].includes(String(requesterRole))) throw new Error("INVALID_INPUT");
  if (!['none','class_rep','official_link','document','other'].includes(String(sourceAccess))) throw new Error("INVALID_INPUT");

  const consentContact = input.consentContact === true;
  const phoneE164 = cleanPhone(input.phoneE164);
  const email = cleanEmail(input.email);
  if ((phoneE164 || email) && !consentContact) throw new Error("CONTACT_CONSENT_REQUIRED");

  return {
    institutionName: cleanText(input.institutionName, 160, true)!,
    programmeName: cleanText(input.programmeName, 160, true)!,
    classGroup: cleanText(input.classGroup, 120, true)!,
    academicPeriod: cleanText(input.academicPeriod, 120),
    requesterRole: requesterRole as TimetableRequestInsert['requesterRole'],
    sourceAccess: sourceAccess as TimetableRequestInsert['sourceAccess'],
    sourceNote: cleanText(input.sourceNote, 1000),
    contactName: cleanText(input.contactName, 120),
    phoneE164,
    email,
    consentContact,
  };
}

function parseFeedback(value: unknown): FeedbackInsert {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_INPUT");
  const input = value as Record<string, unknown>;
  const category = String(input.category ?? "");
  if (!['timetable_problem','calendar_problem','product_feedback','suggestion','praise'].includes(category)) throw new Error("INVALID_INPUT");
  const rating = input.rating == null ? null : Number(input.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error("INVALID_INPUT");
  const consentContact = input.consentContact === true;
  const phoneE164 = cleanPhone(input.phoneE164);
  const email = cleanEmail(input.email);
  if ((phoneE164 || email) && !consentContact) throw new Error("CONTACT_CONSENT_REQUIRED");
  const testimonialPermission = input.testimonialPermission === true;

  return {
    category: category as FeedbackInsert['category'],
    rating,
    message: cleanText(input.message, 4000, true)!,
    publicSlug: cleanText(input.publicSlug, 180),
    contactName: cleanText(input.contactName, 120),
    email,
    phoneE164,
    consentContact,
    testimonialPermission,
  };
}

function sendInputError(res: ServerResponse, error: unknown) {
  const code = error instanceof Error ? error.message : "INVALID_INPUT";
  if (code === "PAYLOAD_TOO_LARGE") {
    sendJson(res, 413, { error: { code, message: "That submission is too large." } });
    return;
  }
  if (code === "CONTACT_CONSENT_REQUIRED") {
    sendJson(res, 400, { error: { code, message: "Consent is required before sending contact details." } });
    return;
  }
  sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "Please check the form and try again." } });
}

export async function handleGrowthCaptureRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const kind = pathname === "/api/public/timetable-requests"
    ? "request"
    : pathname === "/api/public/feedback"
      ? "feedback"
      : null;
  if (!kind) return false;

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
    return true;
  }

  if (!consumeRateLimit(`${requestIp(req)}:${kind}`)) {
    sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "Too many submissions. Please try again shortly." } });
    return true;
  }

  try {
    const body = await readBody(req);
    if (kind === "request") {
      const created = await createTimetableRequest(parseTimetableRequest(body), env);
      sendJson(res, 201, { request: created });
    } else {
      const created = await createProductFeedback(parseFeedback(body), env);
      sendJson(res, 201, { feedback: created });
    }
  } catch (error) {
    if (error instanceof Error && ["PAYLOAD_TOO_LARGE","INVALID_JSON","INVALID_INPUT","CONTACT_CONSENT_REQUIRED"].includes(error.message)) {
      sendInputError(res, error);
    } else {
      sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "We could not save that submission. Please try again." } });
    }
  }
  return true;
}
