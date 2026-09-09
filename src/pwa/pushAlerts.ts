import { registerCalenderZwServiceWorker } from "./serviceWorker";

export type ChangeAlertPlatform = "android" | "ios" | "desktop" | "unknown";
export type ChangeAlertPermission = NotificationPermission | "unsupported";

export type ChangeAlertStatus = {
  enabled: boolean;
  permission: ChangeAlertPermission;
  supported: boolean;
};

type PushPublicConfig = {
  enabled: boolean;
  publicKey?: string;
};

type PushStatusResponse = {
  active: boolean;
};

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function detectPlatform(): ChangeAlertPlatform {
  const userAgent = navigator.userAgent;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  if (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows|Macintosh|Linux/i.test(userAgent)) return "desktop";
  return "unknown";
}

export function changeAlertsSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator
  );
}

async function fetchPushConfig(): Promise<PushPublicConfig> {
  const response = await fetch("/api/public/push/config", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return { enabled: false };
  return (await response.json()) as PushPublicConfig;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error("CHANGE_ALERT_REQUEST_FAILED");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

async function currentBrowserSubscription() {
  const readiness = await registerCalenderZwServiceWorker();
  if (readiness.status !== "registered") return null;
  return readiness.registration.pushManager.getSubscription();
}

export async function getTimetableChangeAlertStatus(
  publicSlug: string,
): Promise<ChangeAlertStatus> {
  if (!changeAlertsSupported()) {
    return { enabled: false, permission: "unsupported", supported: false };
  }

  const permission = Notification.permission;
  const subscription = await currentBrowserSubscription();
  if (!subscription) {
    return { enabled: false, permission, supported: true };
  }

  try {
    const status = await postJson<PushStatusResponse>(
      "/api/public/push/subscriptions/status",
      { publicSlug, endpoint: subscription.endpoint },
    );
    return { enabled: status.active, permission, supported: true };
  } catch {
    return { enabled: false, permission, supported: true };
  }
}

export type EnableChangeAlertResult =
  "enabled" | "permission_denied" | "provider_unavailable" | "unsupported";

export async function enableTimetableChangeAlerts(
  publicSlug: string,
): Promise<EnableChangeAlertResult> {
  if (!changeAlertsSupported()) return "unsupported";

  const config = await fetchPushConfig();
  if (!config.enabled || !config.publicKey) return "provider_unavailable";

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return "permission_denied";

  const readiness = await registerCalenderZwServiceWorker();
  if (readiness.status !== "registered") return "unsupported";

  let subscription = await readiness.registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await readiness.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey),
    });
  }

  const serialized = subscription.toJSON();
  if (
    !serialized.endpoint ||
    !serialized.keys?.p256dh ||
    !serialized.keys?.auth
  ) {
    throw new Error("CHANGE_ALERT_SUBSCRIPTION_INVALID");
  }

  await postJson<{ active: true }>("/api/public/push/subscriptions", {
    publicSlug,
    platform: detectPlatform(),
    subscription: {
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? null,
      keys: {
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
      },
    },
  });
  return "enabled";
}

export async function disableTimetableChangeAlerts(publicSlug: string) {
  if (!changeAlertsSupported()) return;
  const subscription = await currentBrowserSubscription();
  if (!subscription) return;

  await fetch("/api/public/push/subscriptions", {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ publicSlug, endpoint: subscription.endpoint }),
  });
  // Deliberately do not unsubscribe the origin-level browser subscription here:
  // the same endpoint can be opted into more than one timetable.
}
