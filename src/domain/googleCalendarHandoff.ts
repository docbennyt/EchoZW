export const GOOGLE_CALENDAR_HOME_URL =
  "https://calendar.google.com/calendar/r";

export function googleCalendarHandoffKey(subscriptionId: string | null) {
  return `calenderzw_google_calendar_handoff_${subscriptionId || "unknown"}`;
}

export function shouldAutoOpenGoogleCalendar(
  subscriptionId: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
) {
  if (!storage) return true;
  const key = googleCalendarHandoffKey(subscriptionId);
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}
