export const allowedGoogleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.app.created",
] as const;

export const googleCalendarScope = allowedGoogleCalendarScopes[0];

export const disallowedGoogleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
