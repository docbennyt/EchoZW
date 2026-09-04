export const GOOGLE_CALENDAR_HOME_URL =
  "https://calendar.google.com/calendar/u/0/r";

const GOOGLE_CALENDAR_RETURN_KEY = "calenderzw_google_calendar_return";
const GOOGLE_CALENDAR_RETURN_TTL_MS = 30 * 60 * 1000;

type StorageReaderWriter = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type GoogleCalendarReturnState = {
  slug: string;
  savedAt: number;
};

function isSafePublicSlug(value: string) {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("/") &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

export function rememberGoogleCalendarReturnSlug(
  slug: string,
  storage: StorageReaderWriter | null,
  now = Date.now(),
) {
  if (!storage || !isSafePublicSlug(slug)) return;
  try {
    storage.setItem(
      GOOGLE_CALENDAR_RETURN_KEY,
      JSON.stringify({ slug, savedAt: now } satisfies GoogleCalendarReturnState),
    );
  } catch {
    // OAuth navigation still works when browser storage is unavailable.
  }
}

export function getRememberedGoogleCalendarReturnSlug(
  storage: StorageReaderWriter | null,
  now = Date.now(),
) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GOOGLE_CALENDAR_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleCalendarReturnState>;
    if (
      typeof parsed.slug !== "string" ||
      typeof parsed.savedAt !== "number" ||
      !isSafePublicSlug(parsed.slug) ||
      now - parsed.savedAt > GOOGLE_CALENDAR_RETURN_TTL_MS ||
      parsed.savedAt > now + 60_000
    ) {
      storage.removeItem(GOOGLE_CALENDAR_RETURN_KEY);
      return null;
    }
    return parsed.slug;
  } catch {
    return null;
  }
}

export function googleCalendarFailureRecoveryPath(
  calendarStatus: string | null,
  storage: StorageReaderWriter | null,
  now = Date.now(),
) {
  if (!calendarStatus || calendarStatus === "google-success") return null;
  const slug = getRememberedGoogleCalendarReturnSlug(storage, now);
  if (!slug) return null;
  return `/t/${encodeURIComponent(slug)}?calendar=google-failed&reason=${encodeURIComponent(calendarStatus)}`;
}

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
