# Implementation Status

## Working

- React/Vite app named EchoZW Calendar in the EchoZW family by aiDo.
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
- Branded favicon, PWA manifest, Apple touch icon, and EchoZW Calendar header mark from the local branding assets.
- Simple MVP admin route scaffold with production auth requirements documented.
- Public timetable request and upload forms that create admin-visible records.
- Admin-only route surface with local lecture CRUD for create, edit, and delete operations.
- Supabase timetable import schema migration for academic units, programmes, cohorts, periods, courses, source documents, import batches, candidates, warnings, sessions, verification records, audit logs, and private timetable-source storage.
- Timetable import parser helpers for CSV, structured DOCX rows, and assisted master-PDF extracted text with cohort grouping, warning generation, conflict detection, stable session keys, and draft-readiness checks.
- Import documentation for source analysis, architecture, CSV, DOCX, master PDF, course catalogs, review workflow, source traceability, security, and testing.
- Unit and component tests.

## External Blockers

- Supabase project URL and anon key are required for live database, auth, storage, RLS, and server-backed feeds.
- The requested `SIST_Master_Timetable_Semester1_2026(First Draft).pdf` and `MY TIMETABLE.docx` files were not available in the workspace or attachments, so direct source-file extraction remains blocked.
- Supabase MCP authentication was visible as configured but unsupported from the shell environment, so the remote schema was not inspected or migrated from this session.
- Google OAuth credentials are required for direct Google Calendar sync.
- Current official PesePay credentials and API details are required for live checkout and webhook verification.
- `PUBLIC_APP_URL`, `VITE_PUBLIC_APP_URL`, and persistent `/data` storage are required for production calendar subscription links to remain stable.
- Sentry and PostHog keys are required for production observability.
