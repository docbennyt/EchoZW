/* global self, caches, fetch, URL */
/* CalenderZW DR-46 service worker.
 * Public timetable HTML/data, private calendar feeds, runtime config and staff/API
 * traffic are deliberately network-authoritative and are never written to CacheStorage.
 */
const STATIC_CACHE_PREFIX = "calenderzw-static-";
const STATIC_CACHE = `${STATIC_CACHE_PREFIX}v1`;

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isSensitiveOrFreshPath(url, request) {
  const path = url.pathname;
  if (request.mode === "navigate") return true;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/calendar/") ||
    path.startsWith("/sync/") ||
    path.startsWith("/admin") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/t/") ||
    path === "/runtime-config.js" ||
    path.endsWith(".ics")
  ) {
    return true;
  }
  return false;
}

function isSafeStaticAsset(url) {
  const path = url.pathname;
  return (
    path.startsWith("/assets/") ||
    path === "/favicon.svg" ||
    path === "/web-app-manifest-192x192.png" ||
    path === "/web-app-manifest-512x512.png" ||
    path === "/manifest.webmanifest" ||
    path === "/site.webmanifest"
  );
}

self.addEventListener("install", () => {
  // Do not force an active tab onto a new worker. Updates become active through
  // the explicit SKIP_WAITING message or the normal lifecycle.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!sameOrigin(url) || isSensitiveOrFreshPath(url, request)) return;
  if (!isSafeStaticAsset(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

function safeNotificationUrl(value) {
  try {
    const parsed = new URL(String(value || "/"), self.location.origin);
    return parsed.origin === self.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function readPushPayload(event) {
  try {
    return event.data?.json() || {};
  } catch {
    return { body: event.data?.text() || "Your timetable changed." };
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const payload = readPushPayload(event);
      const title =
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim().slice(0, 100)
          : "CalenderZW timetable update";
      const body =
        typeof payload.body === "string" && payload.body.trim()
          ? payload.body.trim().slice(0, 240)
          : "Your published class timetable changed.";
      const tag =
        typeof payload.tag === "string" && payload.tag.trim()
          ? payload.tag.trim().slice(0, 120)
          : "calenderzw-timetable-update";

      await self.registration.showNotification(title, {
        body,
        tag,
        // A provider send can succeed immediately before the worker loses its DB
        // acknowledgement. The stable tag collapses that rare at-least-once retry;
        // renotify=false avoids alerting the student twice for the same outbox item.
        renotify: false,
        icon: "/web-app-manifest-192x192.png",
        badge: "/web-app-manifest-192x192.png",
        data: { url: safeNotificationUrl(payload.url) },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeNotificationUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
