import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createGrowthRequest,
  listGrowthRequests,
  updateGrowthRequest,
  type CreateGrowthRequestInput,
  type GrowthFeedbackType,
  type GrowthRequestStatus,
  type GrowthRequestType,
} from "./growthRequestRepository.js";

const BODY_LIMIT_BYTES = 24 * 1024;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_LIMIT_PER_WINDOW = 12;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export type GrowthRequestDependencies = {
  create?: typeof createGrowthRequest;
  list?: typeof listGrowthRequests;
  update?: typeof updateGrowthRequest;
  now?: () => number;
};

class GrowthRequestApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof GrowthRequestApiError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof Error && error.name === "TESTIMONIAL_CONSENT_REQUIRED") {
    sendJson(res, 409, {
      error: {
        code: "TESTIMONIAL_CONSENT_REQUIRED",
        message: "This feedback did not include testimonial consent.",
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

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new GrowthRequestApiError(
        "PAYLOAD_TOO_LARGE",
        413,
        "That request is too large.",
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    throw new GrowthRequestApiError(
      "INVALID_JSON",
      400,
      "Send a valid JSON request.",
    );
  }
}

function text(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
) {
  if (value === undefined || value === null) {
    if (required) {
      throw new GrowthRequestApiError(
        "VALIDATION_ERROR",
        422,
        `${field} is required.`,
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} must be text.`,
    );
  }
  const cleaned = value.trim();
  if (required && !cleaned) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} is required.`,
    );
  }
  if (cleaned.length > maxLength) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} is too long.`,
    );
  }
  return cleaned || null;
}

function bool(value: unknown, field: string) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} must be true or false.`,
    );
  }
  return value;
}

function optionalUuid(value: unknown, field: string) {
  const cleaned = text(value, field, 64);
  if (!cleaned) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} is invalid.`,
    );
  }
  return cleaned;
}

function normalizeEmail(value: unknown) {
  const cleaned = text(value, "Email", 254);
  if (!cleaned) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleaned)) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      "Enter a valid email address.",
    );
  }
  return cleaned.toLowerCase();
}

function normalizePhone(value: unknown) {
  const cleaned = text(value, "Phone", 24);
  if (!cleaned) return null;
  const compact = cleaned.replace(/[\s()-]/g, "");
  const normalized = compact.startsWith("0")
    ? `+263${compact.slice(1)}`
    : compact;
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      "Enter a phone number in international format, for example +263…",
    );
  }
  return normalized;
}

function oneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      `${field} is invalid.`,
    );
  }
  return value as T;
}

function parseRating(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      "Rating must be between 1 and 5.",
    );
  }
  return rating;
}

function validateSourcePage(value: unknown) {
  const cleaned = text(value, "Source page", 240);
  if (!cleaned) return null;
  if (!cleaned.startsWith("/") || cleaned.includes("//")) {
    throw new GrowthRequestApiError(
      "VALIDATION_ERROR",
      422,
      "Source page is invalid.",
    );
  }
  return cleaned.split("?")[0]?.split("#")[0] ?? null;
}

function parseCreateInput(body: Record<string, unknown>): CreateGrowthRequestInput {
  const requestType = oneOf<GrowthRequestType>(
    body.requestType,
    "Request type",
    ["missing_timetable", "feedback"],
  );
  const contactConsent = bool(body.contactConsent, "Contact consent");
  const testimonialConsent = bool(
    body.testimonialConsent,
    "Testimonial consent",
  );
  const contactEmail = normalizeEmail(body.contactEmail);
  const contactPhoneE164 = normalizePhone(body.contactPhoneE164);

  if ((contactEmail || contactPhoneE164) && !contactConsent) {
    throw new GrowthRequestApiError(
      "CONTACT_CONSENT_REQUIRED",
      422,
      "Consent is required before we store contact details.",
    );
  }
  if (testimonialConsent && (!contactConsent || requestType !== "feedback")) {
    throw new GrowthRequestApiError(
      "TESTIMONIAL_CONSENT_INVALID",
      422,
      "Testimonial permission requires feedback and contact consent.",
    );
  }

  if (requestType === "missing_timetable") {
    return {
      requestType,
      institutionName: text(body.institutionName, "Institution", 180, true),
      programmeName: text(body.programmeName, "Programme", 180, true),
      classGroupLabel: text(body.classGroupLabel, "Class", 120, true),
      academicPeriodName: text(body.academicPeriodName, "Academic period", 160),
      message: text(body.message, "Notes", 4000),
      contactName: text(body.contactName, "Name", 120),
      contactEmail,
      contactPhoneE164,
      contactConsent,
      isClassRep: bool(body.isClassRep, "Class representative"),
      canProvideSource: bool(body.canProvideSource, "Source access"),
      sourcePage: validateSourcePage(body.sourcePage),
    };
  }

  const feedbackType = oneOf<GrowthFeedbackType>(
    body.feedbackType,
    "Feedback type",
    [
      "timetable_problem",
      "product_problem",
      "suggestion",
      "rating",
      "other",
    ],
  );
  return {
    requestType,
    timetableId: optionalUuid(body.timetableId, "Timetable"),
    publicSlug: text(body.publicSlug, "Public slug", 180),
    feedbackType,
    rating: parseRating(body.rating),
    message: text(body.message, "Feedback", 4000, true),
    contactName: text(body.contactName, "Name", 120),
    contactEmail,
    contactPhoneE164,
    contactConsent,
    testimonialConsent,
    sourcePage: validateSourcePage(body.sourcePage),
  };
}

function requestBucketKey(req: IncomingMessage) {
  const forwarded = req.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return candidate?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

function enforceRateLimit(req: IncomingMessage, now: number) {
  const key = requestBucketKey(req);
  const current = rateBuckets.get(key);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > REQUEST_LIMIT_PER_WINDOW) {
    throw new GrowthRequestApiError(
      "RATE_LIMITED",
      429,
      "Too many requests. Please try again in a few minutes.",
    );
  }
}

export async function handleGrowthPublicRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  deps: GrowthRequestDependencies = {},
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/public/growth-requests") return false;
  if (req.method !== "POST") {
    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
    return true;
  }

  try {
    enforceRateLimit(req, (deps.now ?? Date.now)());
    const body = await readJson(req);
    if (typeof body.website === "string" && body.website.trim()) {
      sendJson(res, 202, { accepted: true });
      return true;
    }
    const created = await (deps.create ?? createGrowthRequest)(
      parseCreateInput(body),
      env,
    );
    sendJson(res, 201, {
      request: {
        id: created.id,
        requestType: created.requestType,
        status: created.status,
        createdAt: created.createdAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
  return true;
}

export async function handleGrowthAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  actorId: string,
  env: NodeJS.ProcessEnv = process.env,
  deps: GrowthRequestDependencies = {},
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/admin/growth-requests")) return false;

  try {
    if (req.method === "GET" && url.pathname === "/api/admin/growth-requests") {
      const requestTypeParam = url.searchParams.get("requestType");
      const statusParam = url.searchParams.get("status");
      const limitParam = Number(url.searchParams.get("limit") ?? "50");
      const requestType = requestTypeParam
        ? oneOf<GrowthRequestType>(requestTypeParam, "Request type", [
            "missing_timetable",
            "feedback",
          ])
        : undefined;
      const status = statusParam
        ? oneOf<GrowthRequestStatus>(statusParam, "Status", [
            "new",
            "triaged",
            "in_progress",
            "resolved",
            "closed",
          ])
        : undefined;
      const requests = await (deps.list ?? listGrowthRequests)(
        {
          requestType,
          status,
          limit: Number.isFinite(limitParam) ? limitParam : 50,
        },
        env,
      );
      sendJson(res, 200, { requests });
      return true;
    }

    const match = url.pathname.match(/^\/api\/admin\/growth-requests\/([^/]+)$/);
    if (req.method === "PATCH" && match) {
      const id = optionalUuid(decodeURIComponent(match[1]), "Request id");
      if (!id) {
        throw new GrowthRequestApiError(
          "VALIDATION_ERROR",
          422,
          "Request id is required.",
        );
      }
      const body = await readJson(req);
      const status =
        body.status === undefined
          ? undefined
          : oneOf<GrowthRequestStatus>(body.status, "Status", [
              "new",
              "triaged",
              "in_progress",
              "resolved",
              "closed",
            ]);
      const internalNote =
        body.internalNote === undefined
          ? undefined
          : text(body.internalNote, "Internal note", 4000);
      const testimonialApproved =
        body.testimonialApproved === undefined
          ? undefined
          : bool(body.testimonialApproved, "Testimonial approval");
      const updated = await (deps.update ?? updateGrowthRequest)(
        id,
        { status, internalNote, testimonialApproved },
        actorId,
        env,
      );
      if (!updated) {
        sendJson(res, 404, {
          error: { code: "NOT_FOUND", message: "Request not found." },
        });
        return true;
      }
      sendJson(res, 200, { request: updated });
      return true;
    }

    sendJson(res, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
  } catch (error) {
    sendError(res, error);
  }
  return true;
}
