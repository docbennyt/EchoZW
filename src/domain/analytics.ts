export const ANALYTICS_EVENT_NAMES = [
  "timetable_viewed",
  "calendar_cta_clicked",
  "onboarding_opened",
  "onboarding_step_viewed",
  "onboarding_step_completed",
  "provider_selected",
  "phone_step_completed",
  "reminder_selected",
  "calendar_method_selected",
  "ics_downloaded",
  "subscription_created",
  "subscription_url_copied",
  "apple_calendar_opened",
  "onboarding_completed",
  "onboarding_abandoned",
  "share_prompt_viewed",
  "calendar_drawer_opened",
  "reminder_preset_selected",
  "calendar_provider_selected",
  "calendar_subscription_created",
  "apple_webcal_opened",
  "ics_download_started",
  "ics_download_completed",
  "google_oauth_started",
  "google_oauth_completed",
  "google_oauth_failed",
  "google_calendar_created",
  "google_calendar_sync_completed",
  "google_calendar_sync_failed",
  "calendar_success_viewed",
  "calendar_setup_help_opened",
  "subscription_link_copied",
  "timetable_shared",
  "admin_logged_in",
  "auth_client_error",
  "admin_timetable_created",
  "admin_timetable_published",
  "admin_timetable_updated",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

export const ANALYTICS_PROPERTY_KEYS = [
  "publicSlug",
  "provider",
  "preset",
  "reminderPreset",
  "method",
  "source",
  "status",
  "result",
  "reason",
  "path",
  "mode",
  "timetableId",
  "subscriptionId",
  "versionNumber",
  "sessionCount",
  "customMinutes",
  "offsetMinutes",
  "shareTarget",
  "step",
  "country",
] as const;

const eventNameSet = new Set<string>(ANALYTICS_EVENT_NAMES);
const propertyKeySet = new Set<string>(ANALYTICS_PROPERTY_KEYS);
const sensitiveKeyPattern =
  /(^code$|token|secret|credential|authorization|password|phone|email|push|endpoint|vapid|recovery)/i;

export function isAnalyticsEventName(
  value: unknown,
): value is AnalyticsEventName {
  return typeof value === "string" && eventNameSet.has(value);
}

export function isAnalyticsUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function sanitizeAnalyticsProperties(
  input: unknown,
): AnalyticsProperties {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const output: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (!propertyKeySet.has(key) || sensitiveKeyPattern.test(key)) continue;
    if (value === null || typeof value === "boolean") {
      output[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
      continue;
    }
    if (typeof value === "string") {
      output[key] = value.trim().slice(0, 160);
    }
  }
  return output;
}

export type CoarseClient = {
  deviceKind: "desktop" | "mobile" | "tablet" | "other";
  browserFamily: "chrome" | "safari" | "firefox" | "edge" | "other";
  osFamily: "android" | "ios" | "windows" | "macos" | "linux" | "other";
};

export function classifyAnalyticsClient(
  userAgent: string | undefined,
): CoarseClient {
  const ua = userAgent ?? "";
  const isTablet = /iPad|Tablet|Nexus 7|Nexus 9|SM-T|Tab/i.test(ua);
  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua) && !isTablet;
  const deviceKind: CoarseClient["deviceKind"] = isTablet
    ? "tablet"
    : isMobile
      ? "mobile"
      : ua
        ? "desktop"
        : "other";

  const browserFamily: CoarseClient["browserFamily"] = /Edg\//i.test(ua)
    ? "edge"
    : /Firefox\//i.test(ua)
      ? "firefox"
      : /Chrome\//i.test(ua) || /CriOS\//i.test(ua)
        ? "chrome"
        : /Safari\//i.test(ua)
          ? "safari"
          : "other";

  const osFamily: CoarseClient["osFamily"] = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : /Windows/i.test(ua)
        ? "windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macos"
          : /Linux/i.test(ua)
            ? "linux"
            : "other";

  return { deviceKind, browserFamily, osFamily };
}
