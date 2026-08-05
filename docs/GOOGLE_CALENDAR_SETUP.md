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
3. Add this exact authorised redirect URI in Google Cloud Console:
   `https://calender.aido.co.zw/api/calendar/google/callback`
4. Enable Calendar API.
5. Use `https://www.googleapis.com/auth/calendar.app.created`.
6. Set `PUBLIC_APP_URL` to the production HTTPS origin.
7. Set `GOOGLE_REDIRECT_URI` exactly:
   `https://calender.aido.co.zw/api/calendar/google/callback`
8. Store refresh tokens encrypted server-side only.
9. Create a dedicated secondary calendar per subscription.
10. Upsert events idempotently using internal event IDs and content hashes.

Never write into a student's primary calendar.

`GOOGLE_REDIRECT_URI` is the server-side source of truth for both the
authorization URL and the authorization-code token exchange. Do not derive it
from request host headers, preview domains, frontend location values, or
`PUBLIC_APP_URL`.

Production startup validates that the redirect URI is HTTPS, is not localhost,
has no trailing slash, and uses `/api/calendar/google/callback`.

Safe diagnostics:

```bash
curl -H "x-admin-key: $GOOGLE_CONFIG_STATUS_ADMIN_KEY" \
  https://calender.aido.co.zw/api/calendar/google/config-status
```

The response includes only whether Google OAuth is enabled, the resolved
redirect URI, the client ID suffix, and the scope. It never exposes the client
secret or authorization code. In development, the same endpoint is available
without the admin key.
