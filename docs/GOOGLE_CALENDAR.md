# Google Calendar

Direct Google Calendar sync is behind `VITE_ENABLE_GOOGLE_CALENDAR_SYNC`.

Production steps:

1. Create Google OAuth credentials.
2. Validate OAuth state.
3. Store refresh tokens securely server-side.
4. Create a dedicated Echo Calender calendar per user.
5. Upsert events by stable UID.
6. Retry safe transient failures.
7. Provide disconnect and token removal.

The pilot works without Google OAuth through `.ics` download and subscription instructions.
