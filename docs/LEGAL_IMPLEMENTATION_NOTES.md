# Legal Implementation Notes

This implementation intentionally avoids inventing missing legal details.

Verified from the repository:

- Product UI currently uses `EchoZW Calendar`.
- Legal trading name requested by the prompt is `CalenderZW`.
- Operator/brand currently shown in the app is `aiDo`.
- Public timetable viewing works without an account.
- Google Calendar scope is limited to `https://www.googleapis.com/auth/calendar.app.created`.
- Google sync creates a secondary calendar and inserts mapped timetable events.
- The app does not inspect existing user calendars.
- Private feed tokens are hashed for lookup and raw tokens are not persisted.
- Analytics is a local dev console helper only; no advertising integration is configured.
- PesePay, Supabase, Sentry, and PostHog are documented or scaffolded, not live-active in this repository.

Gaps requiring operator action before production Google OAuth submission:

- Confirm the real legal operator name.
- Provide the real physical/legal address.
- Confirm governing law and dispute venue with legal review.
- Confirm support and privacy inboxes are live.
- Configure `PUBLIC_APP_URL` and Google OAuth redirect URL to the verified domain.
- Configure persistent storage at `/data` or replace the MVP file store with Supabase.
- Implement encrypted refresh-token persistence before promising long-running direct Google re-sync.
- Verify Google OAuth demo video, logo, and app name match the live app.
