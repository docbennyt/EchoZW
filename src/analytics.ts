export type AnalyticsEventName =
  | "calendar_drawer_opened"
  | "reminder_preset_selected"
  | "calendar_provider_selected"
  | "calendar_subscription_created"
  | "apple_webcal_opened"
  | "ics_download_started"
  | "ics_download_completed"
  | "google_oauth_started"
  | "google_oauth_completed"
  | "google_oauth_failed"
  | "google_calendar_created"
  | "google_calendar_sync_completed"
  | "google_calendar_sync_failed"
  | "calendar_success_viewed"
  | "calendar_setup_help_opened"
  | "subscription_link_copied"
  | "timetable_shared"
  | "admin_logged_in"
  | "admin_timetable_created"
  | "admin_timetable_published"
  | "admin_timetable_updated";

export function track(eventName: AnalyticsEventName, properties = {}) {
  if (import.meta.env.DEV) {
    console.info("[analytics]", eventName, properties);
  }
}
