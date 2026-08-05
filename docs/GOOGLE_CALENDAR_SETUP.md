# Google Calendar Setup

Google Calendar is the primary path for Google users because mobile Google Calendar subscription-by-URL is not reliable as a user journey.

Current state:

- UI creates a pending `google_api` subscription.
- Google event payload mapping is implemented and tested.
- Idempotent sync planning is implemented and tested.
- `/api/calendar/google/connect` returns a structured disabled response until credentials are configured.

Production setup:

1. Create a Google Cloud project.
2. Configure OAuth consent screen and test users.
3. Add redirect URI from `GOOGLE_REDIRECT_URI`.
4. Enable Calendar API.
5. Use `https://www.googleapis.com/auth/calendar.app.created`.
6. Set `ENABLE_GOOGLE_CALENDAR_SYNC=true` after server token storage is ready.
7. Store refresh tokens encrypted server-side only.
8. Create a dedicated secondary calendar per subscription.
9. Upsert events idempotently using internal event IDs and content hashes.

Never write into a student's primary calendar.
