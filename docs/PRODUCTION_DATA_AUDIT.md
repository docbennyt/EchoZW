# Production Data Audit

Date: 2026-08-06

## Scope

This audit covers the local repository state for CalenderZW. Supabase MCP tooling was requested, but no Supabase MCP tools were available in this session after tool discovery. Remote project tables, policies, buckets, auth configuration, and migration history therefore remain unverified and must be inspected before any production migration is applied.

## Repository Findings

- Frontend framework: React with Vite.
- Production server: Node HTTP server in `server/productionServer.ts`.
- API surface: implemented through `server/viteCalendarPlugin.ts` for calendar subscriptions, feeds, Google OAuth, revocation, deletion requests, and health.
- Supabase client: none found in application source.
- Service-role usage: none found in application source, but `.env.example` did not previously declare a server-only service-role variable.
- Database migrations: only `supabase/migrations/0001_initial_schema.sql` exists locally.
- Seed data: `supabase/seed/demo.sql` inserts one demo institution only.
- Current remote Supabase state: blocked, no connector available.

## Routes Found

| Route | Component or handler | Current status | Notes |
|------|----------------------|----------------|-------|
| `/` | `HomePage` | Public | Uses public demo/finder content. |
| `/find`, `/institutions` | `FinderPage` | Public | Searches `popularTimetables` fixture data. |
| `/t/*`, `/sync/*` | `PublicTimetablePage` | Public | Renders `demoTimetable` directly. |
| `/*/history` | `HistoryPage` | Public | Renders `demoTimetable.history`. |
| `/dashboard/*` | `DashboardPage` | Public | Shows dashboard metrics from fixture/local UI state. |
| `/admin/login` | `AdminLoginPage` | Blocked locally | Fake client allowlist login retired in this audit pass. |
| `/admin/*` | `AdminLoginPage` | Blocked locally | Routes now land on blocked admin setup state. |
| `/admin/google-verification-readiness` | `GoogleVerificationReadinessPage` | Public before router order | Currently still matched before the admin block; not an admin mutation surface, but should move out of `/admin` or be protected. |
| `/account/settings` | `AccountSettingsPage` | Public | Shows local message for Google disconnect; real endpoint exists separately. |
| `/privacy`, `/terms`, `/data-deletion`, `/support` | Static React pages and public HTML | Public | Legal/support pages. |
| `/healthz` | Server handler | Public | Returns basic service status. |
| `/api/calendar/subscriptions` | Server handler | Public POST | Persists to JSON file or memory, not Supabase. |
| `/calendar/feed/:token.ics` | Server handler | Public token route | Reads JSON/in-memory subscriptions and `demoTimetable`. |
| `/calendar/download/:id.ics` | Server handler | Public ID route | Reads JSON/in-memory subscriptions and `demoTimetable`. |
| `/api/calendar/google/connect` | Server handler | Public redirect | Uses JSON/in-memory subscriptions and demo timetable slug. |
| `/api/calendar/google/callback` | Server handler | Public OAuth callback | Inserts Google events immediately from `demoTimetable`; no durable sync jobs. |
| `/api/calendar/google/disconnect` | Server handler | Public POST | Marks local subscription disconnected when ID is known. |
| `/api/calendar/subscriptions/:id/revoke` | Server handler | Public POST | Revokes by subscription ID; ownership not enforced. |
| `/api/calendar/google/config-status` | Server handler | Dev public or production key-protected | Uses `GOOGLE_CONFIG_STATUS_ADMIN_KEY`, not Supabase auth. |
| `/api/account/delete-request` | Server handler | Public POST | Acknowledges request, no Supabase persistence. |

## Data Source Table

| Area | Current source | Persistent? | Secure? | Production-ready? | Action |
|------|----------------|-------------|---------|-------------------|--------|
| Public timetable page | `src/domain/timetableData.ts` `demoTimetable` | No | No draft/public separation | No | Replace with Supabase published projection loader. |
| Finder | `popularTimetables` fixture | No | No | No | Query active institutions/programmes/timetables from Supabase. |
| History page | `demoTimetable.history` | No | No | No | Query published version history only. |
| Admin login | Previously browser `VITE_MVP_ADMIN_EMAILS` | No | No | No | Retired; implement Supabase Auth server session and role lookup. |
| Admin timetable CRUD | React state from `demoTimetable.events` | No | No | No | Replace with transactional server operations and RLS-backed tables. |
| Public requests/uploads | `localStorage` key `calenderzw_submissions` | Browser only | No | No | Persist reports/uploads to private Supabase tables/storage. |
| Dashboard analytics | UI/demo counts | No | No | No | Replace with audited analytics/event tables. |
| Calendar subscriptions | JSON file at `CALENDAR_STORE_PATH` or in-memory maps | Sometimes | Tokenized but not authorization-safe | No | Move to Supabase `calendar_subscriptions`; hash feed tokens server-side. |
| Calendar feeds | JSON/in-memory subscription plus `demoTimetable` | Sometimes | Token route only | No | Read current published version, sessions, exceptions, preferences. |
| Google OAuth state | In-memory `Map` | No | Not durable | No | Store encrypted connection state and durable sync jobs. |
| Google sync | Immediate network calls in OAuth callback | No job durability | No idempotent job queue | No | Add `calendar_sync_jobs` and worker/cron endpoint. |
| Supabase schema | One initial migration | Repo only | RLS absent | No | Add canonical schema, helper functions, policies, tests. |
| RLS | None in local migration | N/A | No | No | Enable RLS on all exposed tables. |
| Audit logs | Documented only | No | N/A | No | Add `audit_logs` and write from sensitive operations. |
| Health checks | `/healthz` | N/A | Basic | Partial | Add `/health` and `/health/database` without sensitive diagnostics. |

## Mock and Local Persistence Inventory

- `src/domain/timetableData.ts`: hardcoded BSc Software Engineering timetable and popular timetable copies.
- `src/App.tsx`: public timetable, finder, history, dashboard, and dead admin workbench depend on fixture data.
- `src/App.tsx`: public request/upload submissions use `localStorage`.
- `server/viteCalendarPlugin.ts`: imports `demoTimetable`; stores subscriptions in process maps and a JSON file.
- `src/integrations/payments.ts`: mock PesePay adapter.
- Tests import `demoTimetable` as the expected source for calendar and public UI behavior.

## Supabase Gap

Local migration `0001_initial_schema.sql` creates a pilot schema with `institutions`, `timetables`, `timetable_versions`, `calendar_events`, `correction_reports`, `feed_tokens`, `calendar_subscriptions`, and `calendar_event_sync_records`. It does not model campuses, faculties, departments, programmes, cohorts, academic periods, programme-course relationships, timetable sessions, exceptions, reports, sync jobs, profiles, roles, or audit logs as required.

No RLS policies, helper authorization functions, indexes, triggers, storage buckets, or auth bootstrap flow are present locally.

## Immediate Containment Applied

- Browser allowlist admin login was retired.
- `VITE_MVP_ADMIN_EMAILS` was removed from `.env.example`.
- `/admin/*` now renders a blocked admin setup state instead of the mock admin workbench.

## Blockers

- Supabase MCP/CLI access is unavailable in this session, so remote schema reconciliation and safe migration application cannot be performed yet.
- No `@supabase/supabase-js` dependency or server session framework exists in the app.
- The current production server is a lightweight Node HTTP server, so authenticated server actions, CSRF protection, and transactional database operations must be designed deliberately rather than assumed from a full-stack framework.
