import {
  sanitizeAnalyticsProperties,
  type AnalyticsEventName,
  type AnalyticsProperties,
} from "./domain/analytics";

export type { AnalyticsEventName } from "./domain/analytics";

const PRODUCT_KEY = "calenderzw";
const ANONYMOUS_STORAGE_KEY = "calenderzw_analytics_anonymous_id";
const SESSION_STORAGE_KEY = "calenderzw_analytics_session_id";
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 900;

type QueuedAnalyticsEvent = {
  name: AnalyticsEventName;
  properties: AnalyticsProperties;
  clientTimestamp: string;
};

let memoryAnonymousId: string | null = null;
let memorySessionId: string | null = null;
let queue: QueuedAnalyticsEvent[] = [];
let flushTimer: number | undefined;
let lifecycleBound = false;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4${Math.random()
      .toString(16)
      .slice(2, 5)}-8${Math.random().toString(16).slice(2, 5)}-${Math.random()
      .toString(16)
      .slice(2, 14)}`;
}

function readOrCreate(
  storage: Storage | undefined,
  key: string,
  memoryValue: string | null,
) {
  if (!storage) return memoryValue ?? makeId();
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = makeId();
    storage.setItem(key, created);
    return created;
  } catch {
    return memoryValue ?? makeId();
  }
}

export function getAnalyticsIdentity() {
  const local = typeof window !== "undefined" ? window.localStorage : undefined;
  const session =
    typeof window !== "undefined" ? window.sessionStorage : undefined;

  memoryAnonymousId = readOrCreate(
    local,
    ANONYMOUS_STORAGE_KEY,
    memoryAnonymousId,
  );
  memorySessionId = readOrCreate(
    session,
    SESSION_STORAGE_KEY,
    memorySessionId,
  );

  return {
    anonymousId: memoryAnonymousId,
    sessionId: memorySessionId,
  };
}

function payloadFor(events: QueuedAnalyticsEvent[]) {
  return JSON.stringify({
    productKey: PRODUCT_KEY,
    ...getAnalyticsIdentity(),
    events,
  });
}

function scheduleFlush() {
  if (typeof window === "undefined" || flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flushAnalytics();
  }, FLUSH_DELAY_MS);
}

function bindLifecycleFlush() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;

  const flushWithBeacon = () => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH_SIZE);
    const body = payloadFor(batch);
    try {
      if (navigator.sendBeacon) {
        const sent = navigator.sendBeacon(
          "/api/analytics/events",
          new Blob([body], { type: "application/json" }),
        );
        if (sent) return;
      }
    } catch {
      // Fall back to keepalive fetch below.
    }

    void fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  };

  window.addEventListener("pagehide", flushWithBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWithBeacon();
  });
}

export function track(
  eventName: AnalyticsEventName,
  properties: Record<string, unknown> = {},
) {
  const safeProperties = sanitizeAnalyticsProperties(properties);

  if (import.meta.env.DEV) {
    console.info("[analytics]", eventName, safeProperties);
  }

  queue.push({
    name: eventName,
    properties: safeProperties,
    clientTimestamp: new Date().toISOString(),
  });
  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
  }

  bindLifecycleFlush();
  if (queue.length >= MAX_BATCH_SIZE) {
    void flushAnalytics();
  } else {
    scheduleFlush();
  }
}

export async function flushAnalytics() {
  if (typeof fetch !== "function" || queue.length === 0) return;

  if (flushTimer !== undefined && typeof window !== "undefined") {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    const response = await fetch("/api/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadFor(batch),
      credentials: "same-origin",
      keepalive: true,
    });
    if (!response.ok && response.status >= 500) {
      queue = [...batch, ...queue].slice(0, MAX_QUEUE_SIZE);
    }
  } catch {
    queue = [...batch, ...queue].slice(0, MAX_QUEUE_SIZE);
  }

  if (queue.length > 0) scheduleFlush();
}
