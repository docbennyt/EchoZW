# Google Calendar Setup

Google Calendar is the primary path for Google users because mobile Google Calendar subscription-by-URL is not reliable as a user journey.

Current state:

- UI creates a pending `google_api` subscription.
- Google event payload mapping is implemented and tested.
- Idempotent sync planning is implemented and tested.
- `/api/calendar/google/connect` starts OAuth when credentials are configured.
- `/api/calendar/google/callback` exchanges the code, creates a dedicated secondary calendar, and inserts events with selected reminder overrides.

Production setup:

1. Create a Google Cloud project.
2. Configure OAuth consent screen and test users.
3. Add redirect URI from `GOOGLE_REDIRECT_URI`.
4. Enable Calendar API.
5. Use `https://www.googleapis.com/auth/calendar.app.created`.
6. Set `PUBLIC_APP_URL` to the production HTTPS origin.
7. Set `GOOGLE_REDIRECT_URI` to `<PUBLIC_APP_URL>/api/calendar/google/callback`.
8. Store refresh tokens encrypted server-side only.
9. Create a dedicated secondary calendar per subscription.
10. Upsert events idempotently using internal event IDs and content hashes.

Never write into a student's primary calendar.
