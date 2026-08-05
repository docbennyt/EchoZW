# Implementation Status

## Working

- React/Vite app named Echo Calender in the EchoZW family by aiDo.
- Public timetable route at `/t/zou-bscse-2-1-2026-s2`.
- Mobile-first timetable summary, verification badge, next lecture, agenda view, and week view.
- Compact three-step Add drawer with timetable summary, reminder presets, custom reminders, and a provider step that always shows Google Calendar, Apple Calendar, `.ics` download, and copy-link actions.
- Correction report form with Zod validation.
- Finder route with popular timetable results and request prompt.
- Dashboard route for pilot operations.
- Update history route.
- Calendar generation domain with stable event IDs, RRULE, EXDATE, VALARM, escaping, and line folding.
- Mock PesePay provider interface.
- Future AI extraction provider interface.
- Vite dev/preview middleware for personalised calendar subscription creation and `text/calendar` feed responses.
- Simple MVP admin route scaffold with production auth requirements documented.
- Public timetable request and upload forms that create admin-visible records.
- Admin-only route surface with local lecture CRUD for create, edit, and delete operations.
- Unit and component tests.

## External Blockers

- Supabase project URL and anon key are required for live database, auth, storage, RLS, and server-backed feeds.
- Google OAuth credentials are required for direct Google Calendar sync.
- Current official PesePay credentials and API details are required for live checkout and webhook verification.
- A deployed server or edge function is required to return persistent production `text/calendar` subscribed feed URLs.
- Sentry and PostHog keys are required for production observability.
