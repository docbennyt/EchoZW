export const ANALYTICS_EVENT_NAMES = [
  "landing_viewed",
  "pilot_offer_viewed",
  "pilot_cta_clicked",
  "future_price_viewed",
  "pricing_viewed",
  "pricing_cta_clicked",
  "checkout_started",
  "checkout_method_family",
  "checkout_completed",
  "checkout_failed",
  "entitlement_created",
  "finder_opened",
  "finder_search_started",
  "institution_selected",
  "programme_selected",
  "class_group_selected",
  "timetable_search_completed",
  "timetable_search_no_results",
  "timetable_result_opened",
  "timetable_viewed",
  "personal_timetable_preview_opened",
  "personal_timetable_pdf_downloaded",
  "personal_timetable_png_downloaded",
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
  "shared_link_opened",
  "shared_link_onboarding_started",
  "shared_link_onboarding_completed",
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
  "share_link_opened",
  "push_alert_cta_clicked",
  "push_alert_enabled",
  "push_alert_disabled",
  "push_alert_permission_denied",
  "staff_signup_completed",
  "staff_install_offer_viewed",
  "staff_install_clicked",
  "staff_install_result",
  "staff_install_detected",
  "staff_onboarding_completed",
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
  "entryPath",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "shareAttributionId",
  "institutionId",
  "programmeId",
  "classGroupId",
  "failureClass",
  "planCode",
  "currency",
  "amountMinor",
  "methodFamily",
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
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return output;
}
