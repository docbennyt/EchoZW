export type DeviceKind = "ios" | "android" | "desktop" | "unknown";
export type CalendarProvider =
  | "google_api"
  | "apple_subscription"
  | "webcal_subscription"
  | "ics_download"
  | "outlook_subscription";

export function detectDevice(
  userAgent: string,
  maxTouchPoints = 0,
): DeviceKind {
  const ua = userAgent.toLowerCase();
  const isiPadDesktopUa =
    ua.includes("macintosh") && maxTouchPoints > 1 && ua.includes("safari");
  if (/iphone|ipad|ipod/.test(ua) || isiPadDesktopUa) return "ios";
  if (ua.includes("android")) return "android";
  if (
    ua.includes("windows") ||
    ua.includes("macintosh") ||
    ua.includes("linux")
  )
    return "desktop";
  return "unknown";
}

export function orderedProvidersForDevice(
  device: DeviceKind,
): CalendarProvider[] {
  if (device === "ios") {
    return ["apple_subscription", "google_api", "ics_download"];
  }
  if (device === "android") {
    return ["ics_download", "webcal_subscription", "google_api"];
  }
  if (device === "desktop") {
    return [
      "google_api",
      "webcal_subscription",
      "ics_download",
      "apple_subscription",
    ];
  }
  return ["google_api", "apple_subscription", "ics_download"];
}

export type CalendarPlatform =
  "ios" | "macos" | "android" | "windows" | "linux" | "unknown";
export type CalendarDestination = "apple" | "google" | "advanced";

export function detectCalendarPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): CalendarPlatform {
  const ua = userAgent.toLowerCase();
  const isiPadDesktopUa =
    ua.includes("macintosh") && maxTouchPoints > 1 && ua.includes("safari");
  if (/iphone|ipad|ipod/.test(ua) || isiPadDesktopUa) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function orderedCalendarDestinations(
  platform: CalendarPlatform,
): CalendarDestination[] {
  return platform === "ios" || platform === "macos"
    ? ["apple", "google", "advanced"]
    : ["google", "apple", "advanced"];
}
