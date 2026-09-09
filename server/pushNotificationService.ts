import type {
  ClaimedPushDelivery,
  ClaimedPushOutbox,
} from "./pushNotificationRepository.js";

export type PushDeliveryDecision = {
  result: "retry" | "terminal";
  errorCode: string;
  retryAfterSeconds: number | null;
};

type WebPushErrorLike = {
  statusCode?: number;
  headers?: Record<string, string | string[] | undefined>;
  message?: string;
  code?: string;
};

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseRetryAfterSeconds(
  raw: string | undefined,
  nowMs = Date.now(),
) {
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds), 3600);
  }
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(Math.max(Math.ceil((dateMs - nowMs) / 1000), 1), 3600);
}

export function classifyWebPushFailure(error: unknown): PushDeliveryDecision {
  const candidate =
    error && typeof error === "object"
      ? (error as WebPushErrorLike)
      : ({} as WebPushErrorLike);
  const status = Number(candidate.statusCode ?? 0);

  // Web Push providers use 404/410 to signal that the endpoint capability URL
  // is permanently gone. Those are the only statuses that expire a student's
  // timetable-specific push subscription automatically.
  if (status === 404 || status === 410) {
    return {
      result: "terminal",
      errorCode: `HTTP_${status}`,
      retryAfterSeconds: null,
    };
  }

  const retryAfter = parseRetryAfterSeconds(
    headerValue(candidate.headers?.["retry-after"]),
  );
  const code = status
    ? `HTTP_${status}`
    : String(candidate.code || "PUSH_NETWORK_FAILURE")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 120);

  // Everything else is bounded-retry, including 401/403. Those responses can
  // represent VAPID/configuration problems affecting every endpoint, so they
  // must never be mistaken for evidence that one student's endpoint is dead.
  return {
    result: "retry",
    errorCode: code || "PUSH_NETWORK_FAILURE",
    retryAfterSeconds: retryAfter,
  };
}

function humanChangeLabel(changeKind: string, count: number) {
  const plural = count === 1 ? "" : "s";
  switch (changeKind) {
    case "added":
      return `${count} class${plural} added`;
    case "cancelled":
      return `${count} class${plural} cancelled`;
    case "moved":
      return count === 1 ? "A class moved" : `${count} classes moved`;
    case "time_changed":
      return count === 1
        ? "A class time changed"
        : `${count} class times changed`;
    case "venue_changed":
      return count === 1 ? "A venue changed" : `${count} venues changed`;
    case "restored":
      return count === 1
        ? "A class was restored"
        : `${count} classes were restored`;
    case "updated":
      return count === 1 ? "A class changed" : `${count} classes changed`;
    default:
      return `${count} timetable change${plural}`;
  }
}

export function buildPushPayload(outbox: ClaimedPushOutbox) {
  const courseCode =
    typeof outbox.payload.courseCode === "string"
      ? outbox.payload.courseCode.trim().slice(0, 24)
      : "";
  const label = humanChangeLabel(outbox.changeKind, outbox.changeCount);
  const body = courseCode ? `${courseCode}: ${label}.` : `${label}.`;

  return JSON.stringify({
    title: "CalenderZW timetable update",
    body,
    tag: `calenderzw-${outbox.id}`,
    url: `/t/${encodeURIComponent(outbox.publicSlug)}`,
  });
}

export function webPushSubscriptionFor(delivery: ClaimedPushDelivery) {
  return {
    endpoint: delivery.endpoint,
    keys: {
      p256dh: delivery.p256dh,
      auth: delivery.authSecret,
    },
  };
}
