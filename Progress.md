# CalenderZW Pilot Progress

## 1. Pilot mission

CalenderZW must allow the operator to publish a class-specific university timetable and allow students in that exact class group to add it to their calendars through a personalised .ics download or subscription feed.

The pilot is not yet VERIFIED.

## 2. Pilot completion path

- [ ] Admin authentication works
- [ ] Institution CRUD works
- [ ] Programme CRUD works
- [ ] Class-group CRUD works
- [ ] Academic-period CRUD works
- [ ] Timetable creation works
- [ ] Draft timetable session CRUD works
- [ ] Timetable publication works
- [ ] Public timetable reads published Supabase data
- [ ] Personalised .ics reads published Supabase data
- [ ] Calendar subscription feed reads published Supabase data
- [ ] Venue correction and republish work
- [ ] Anonymous users cannot access administration
- [ ] Anonymous users cannot mutate Supabase data
- [x] Mock production data has been removed
- [ ] Full pilot journey has been verified end to end

## 3. Explicitly out of scope

- Google Calendar direct OAuth sync
- Apple-specific advanced integration beyond webcal subscription
- AI PDF/DOCX timetable extraction
- Assignment reminders
- Grade tracking
- Payments
- Student accounts
- Class-representative roles
- Institution-admin role hierarchy
- Verifier roles
- Complex analytics
- Paid acquisition
- Major visual redesign
- Advanced document upload
- Multi-university onboarding automation

These items may not be implemented during this pilot-completion pass.

## 4. Current architecture truth

| Area | Current implementation | Real persistence? | Secure? | Status |
|------|-------------------------|-------------------|---------|--------|
| frontend framework | React + Vite + TypeScript in `src/App.tsx` with path-based routing from `window.location.pathname`. | No | Partial | IN PROGRESS |
| production server | Node HTTP server in `server/productionServer.ts` serves `dist/`, `/healthz`, calendar API routes, and SPA shell. | No | Partial | IN PROGRESS |
| route system | Manual route switches in `App`; `/dashboard` redirects client-side to `/admin`; production server returns 308 for `/dashboard`. | No | Partial | VERIFIED |
| Supabase clients | Browser publishable-key client remains client-only; server user/admin clients now exist in `server/supabase/*`, validate config, and require `SUPABASE_SERVICE_ROLE_KEY` for server admin authorization. | No | Partial | IN PROGRESS |
| authentication | `/admin/login` uses Supabase email/password sign-in, `/admin` checks the browser session with `/api/admin/session`, and admin API routes require a Supabase user plus active `admin_users` row. Not verified against persisted Supabase state yet. | No | Partial | BLOCKED |
| database schema | Local migrations `0001_initial_schema.sql` and `0002_timetable_import_pipeline.sql` exist. New migration `0003_secure_admin_auth.sql` creates `admin_users`, enables RLS, revokes anon/authenticated table access, and intentionally exposes no browser policies. It has not been applied remotely. | Local only | Partial | BLOCKED |
| source of public timetable data | `src/App.tsx` no longer imports `demoTimetable` or `popularTimetables`; timetable links render a truthful unpublished/unavailable state until a Supabase repository exists. | No | Partial | VERIFIED |
| source of admin timetable data | The retired mock admin workbench was removed from production route rendering on 2026-08-06; real admin data source is not implemented. | No | Partial | VERIFIED |
| source of .ics data | Server .ics download rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when `ALLOW_DEMO_DATA=false`; no client route offers fake .ics download from the unavailable public timetable page. | No | Partial | VERIFIED |
| source of subscription-feed data | `server/viteCalendarPlugin.ts` stores subscriptions in process maps and optional JSON file from `CALENDAR_STORE_PATH`; demo-backed subscription creation/feed/download are disabled unless explicit non-production demo mode is enabled. | File only | Partial | VERIFIED |
| mock data | `demoTimetable`, `popularTimetables`, local seed data, tests, and historical docs remain only as fixtures, development/demo mode inputs, or documentation references. | No | Partial | VERIFIED |
| duplicate dashboards | The separate React `/dashboard` component and mock `/admin` workbench were removed from renderable source; stale CSS selectors remain unused. | No | Partial | VERIFIED |
| production environment configuration | `src/domain/demoConfig.ts` defaults demo mode off, accepts only `ALLOW_DEMO_DATA=true`, and forces false whenever runtime mode, `APP_ENV`, or `NODE_ENV` is production. | No | Partial | VERIFIED |

## 5. Canonical pilot architecture

Public React application -> authenticated/public Node API -> Supabase PostgreSQL -> calendar generation domain -> .ics download and subscription feed.

Supabase PostgreSQL is the canonical source of truth.

## 6. Current phase

Current phase: PHASE 2 — Secure admin authentication: BLOCKED

## 7. Phase tracker

| Phase | Status | Entry condition | Exit evidence |
|------|--------|-----------------|---------------|
| 0. Repository and Supabase audit | VERIFIED | Start from existing repository state and read `Progress.md`. | Local audit recorded here on 2026-08-06; Supabase MCP unavailable, so remote state is recorded as BLOCKED. |
| 1. Remove duplicate/mock production paths | VERIFIED | Phase 0 audit recorded. | Public timetable, finder, history, static links, `/dashboard`, `/admin`, calendar subscription creation, .ics download, and calendar feed no longer serve fake timetable/calendar data when `ALLOW_DEMO_DATA=false`. Tests, lint, build, and production smoke evidence recorded below. |
| 2. Secure admin authentication | BLOCKED | Phase 1 VERIFIED. | Code, focused tests, lint, build, and anonymous production smoke passed. Remote Supabase migration/admin-user verification is blocked because callable Supabase MCP tools and server credentials are unavailable. |
| 3. Create canonical Supabase schema | NOT STARTED | Phase 2 VERIFIED. | Not yet available. |
| 4. Institution/programme/class-group/period CRUD | NOT STARTED | Phase 3 VERIFIED. | Not yet available. |
| 5. Timetable draft and session CRUD | NOT STARTED | Phase 4 VERIFIED. | Not yet available. |
| 6. Timetable publication | NOT STARTED | Phase 5 VERIFIED. | Not yet available. |
| 7. Public timetable integration | NOT STARTED | Phase 6 VERIFIED. | Not yet available. |
| 8. Personalised calendar integration | NOT STARTED | Phase 7 VERIFIED. | Not yet available. |
| 9. End-to-end pilot verification | NOT STARTED | Phase 8 VERIFIED. | Not yet available. |
| 10. Production cleanup | NOT STARTED | Phase 9 VERIFIED. | Not yet available. |

## 8. Decisions

| Date | Decision | Reason |
|------|----------|--------|
| 2026-08-06 | `/admin` is the only administration surface. | The pilot needs one operator workflow, not competing dashboards. |
| 2026-08-06 | `/dashboard` redirects to `/admin`. | Existing links may exist, but the route must not render a separate dashboard. |
| 2026-08-06 | Student access does not require an account. | The pilot flow is anonymous public timetable access plus private calendar links. |
| 2026-08-06 | One trusted admin role is sufficient for the pilot. | Representative, verifier, and institution-admin roles are out of scope. |
| 2026-08-06 | Manual timetable entry is the primary pilot ingestion method. | CSV/PDF/DOCX/AI ingestion adds risk before the core flow is verified. |
| 2026-08-06 | CSV import is postponed until the manual workflow is verified. | Import tooling should not define the pilot. |
| 2026-08-06 | Public timetable data comes only from the current published database version. | Students must see the operator-published version, not fixtures or drafts. |
| 2026-08-06 | Production must never fall back to demo data. | Empty/error states are safer than false timetable information. |
| 2026-08-06 | Demo mode is server-gated by `ALLOW_DEMO_DATA`, `APP_ENV`, and `NODE_ENV`, not by a client-only Vite variable. | Calendar API enforcement must happen on the server and production must force demo mode off. |
| 2026-08-06 | Google Calendar direct sync remains disabled. | The pilot calendar surface is .ics download plus subscription feed. |

## 9. Database state

- Applied local migrations: `supabase/migrations/0001_initial_schema.sql`, `supabase/migrations/0002_timetable_import_pipeline.sql` exist in the repo; not re-applied in this session.
- New local migration pending application: `supabase/migrations/0003_secure_admin_auth.sql` creates `public.admin_users` with `user_id`, `active`, `created_at`, `created_by`, `disabled_at`, and `notes`; enables RLS; revokes anon/authenticated table privileges; and adds focused indexes.
- Applied remote migrations: BLOCKED because no Supabase MCP or remote database connection is available in this Codex session.
- Existing production tables: BLOCKED because remote schema inspection is unavailable.
- Migration drift: Unknown until remote migration history and schema are inspected.
- Seed-data state: `supabase/seed/demo.sql` inserts a demo institution; no seed command was run this session.
- RLS state: Local migration `0002` enables RLS on several import/hierarchy tables. Pending migration `0003` enables RLS on `admin_users` and exposes no direct browser policies because admin authorization is checked server-side with the service-role client.
- Current admin user state: Unknown; no remote auth user inspection is available and no `admin_users` row was provisioned in this session.

## 10. Route state

| Route | Purpose | Authentication | Data source | Status |
|------|---------|----------------|-------------|--------|
| / | Public home | Anonymous | Static React content; no active sample timetable link | VERIFIED |
| /find | Timetable finder | Anonymous | Truthful empty state until published Supabase data exists | VERIFIED |
| /t/:slug | Public timetable | Anonymous | Truthful unavailable state; no `demoTimetable` rendering | VERIFIED |
| /admin/login | Admin login | Anonymous until form submit | Supabase email/password sign-in; no signup path | IN PROGRESS |
| /admin | Canonical admin surface | Supabase session plus active `admin_users` row via `/api/admin/session` | Minimal verified-admin shell only; no CRUD controls yet | BLOCKED |
| /admin/institutions | Institution management | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /admin/programmes | Programme management | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /admin/class-groups | Class-group management | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /admin/academic-periods | Academic-period management | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /admin/timetables | Timetable list | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /admin/timetables/:id | Timetable editor | Supabase session plus active `admin_users` row via `/admin/*` guard | Not implemented after guard | NOT STARTED |
| /api/admin/session | Admin session validation | Bearer token verified by Supabase Auth, then active `admin_users` lookup | Returns typed 401/403/503 errors or safe user id/email only | IN PROGRESS |
| /calendar/download/:subscriptionId.ics | Personalised .ics download | Capability weak; enumerable ID | Rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when demo data is disabled | VERIFIED |
| /calendar/feed/:token.ics | Private calendar subscription feed | Token hash lookup | Rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when demo data is disabled | VERIFIED |
| /api/calendar/subscriptions | Calendar subscription creation | Anonymous API | Rejects demo-backed creation with `TIMETABLE_NOT_PUBLISHED`; no record is created when demo data is disabled | VERIFIED |
| /dashboard | Retired dashboard route | Redirects to `/admin` | None | VERIFIED |

## 11. Verification evidence

### Repository and route audit verification

Date:
2026-08-06 22:15 Africa/Harare

Action:
Read `Progress.md`, inspected route definitions, Supabase utilities, local migrations, calendar server routes, mock-data references, and package scripts.

Evidence:
- `/dashboard` previously rendered fake metrics `1,248`, `534`, `7`, `18` and role cards for Representative, Verifier, and Institution admin.
- `/admin` previously rendered a mock workbench seeded from `demoTimetable.events`.
- Public timetable and calendar generation used `demoTimetable`.
- Local Supabase migrations are partial and do not match the requested canonical pilot schema.
- Supabase MCP/remote schema tools are not available in this session.

Test result:
- `npm test -- App.test.tsx`: passed, 10 tests.
- `npm run build`: passed.

### Duplicate dashboard route verification

Date:
2026-08-06 22:16 Africa/Harare

Action:
Removed renderable dashboard/workbench components, changed global navigation to `/admin`, added client `/dashboard` redirect, added production server 308 redirect, and added route tests.

Expected result:
`/dashboard` no longer renders a separate dashboard; `/admin` does not expose mock lecture controls.

Actual result:
`/dashboard` becomes `/admin` in the SPA test and renders the blocked admin login state. `/admin` renders the blocked admin login state. Mock dashboard metrics and mock admin controls are absent from renderable React source.

Test result:
- `npm test -- App.test.tsx`: passed, 10 tests.
- `npm run build`: passed.

### Phase 1 demo-data guard verification

Date:
2026-08-06 23:45 Africa/Harare

Action:
Added `src/domain/demoConfig.ts`, routed calendar API demo enforcement through it, removed client public timetable/finder/history/demo links from production-renderable React/static paths, and added focused tests.

Expected result:
Production cannot serve fake timetable or fake calendar data under a fallback path. Development demo behavior remains possible only when explicitly enabled outside production.

Actual result:
- `ALLOW_DEMO_DATA` defaults to false.
- `ALLOW_DEMO_DATA=true` is accepted only outside production.
- Runtime production mode, `APP_ENV=production`, or `NODE_ENV=production` forces demo mode false.
- `/t/zou-bscse-2-1-2026-s2` renders an unavailable state in the React route tests and does not expose demo timetable title, weekly agenda, or calendar buttons.
- `/find` renders an empty published-timetable state and no longer filters `popularTimetables`.
- Calendar subscription creation, .ics download, and subscription feeds return typed `TIMETABLE_NOT_PUBLISHED` errors when demo data is disabled.
- A calendar store/repository load error does not fall back to demo data.
- Explicit non-production demo mode still creates a demo-backed subscription and feed in tests.

Test result:
- `npm test -- demoDataConfig.test.ts`: passed, 9 tests.
- `npm test -- App.test.tsx`: passed, 10 tests.
- `npm test`: passed, 14 test files, 72 tests.
- `npm run lint`: passed with warnings for unused React components left after mock-route removal: `NextLectureCard`, `AgendaView`, `WeekView`, `TimetableHero`, `SyncWizard`.
- `npm run build`: passed.

Production smoke result with `NODE_ENV=production`, `APP_ENV=production`, `ALLOW_DEMO_DATA=false`, and `ENABLE_GOOGLE_CALENDAR_SYNC=false`:
- `PORT=4190` `/dashboard`: HTTP 308 with `Location: /admin`.
- `PORT=4190` `/admin`: HTTP 200 SPA shell; route test verifies blocked admin login and no mock workbench.
- `PORT=4190` `/t/zou-bscse-2-1-2026-s2`: HTTP 200 SPA shell, raw shell did not contain demo timetable text; route test verifies unavailable state.
- `PORT=4194` `POST /api/calendar/subscriptions` with `tt-aido-bscse-21-2026-s2`: HTTP 404 JSON error code `TIMETABLE_NOT_PUBLISHED`.
- `PORT=4190` `/calendar/download/subscription-id.ics`: HTTP 404 JSON error code `TIMETABLE_NOT_PUBLISHED`.
- `PORT=4190` `/calendar/feed/dev-token.ics`: HTTP 404 JSON error code `TIMETABLE_NOT_PUBLISHED`.

Production-source scan classification:
- `demoTimetable`: retained in `src/domain/timetableData.ts` as a fixture module; retained in `server/viteCalendarPlugin.ts` only behind `isDemoDataAllowed(process.env, mode)`; retained in tests; retained in historical docs and this progress file as an audited reference.
- `zou-bscse-2-1-2026-s2`: retained in fixture data, tests, and historical docs; removed from active homepage/static legal/footer sample links and public React route generation.
- `1,248`: retained only in route tests/progress as a negative assertion or historical dashboard evidence.
- `534`: retained only in historical progress evidence and as a false-positive byte sequence inside built asset data.
- `Representative`: retained only in historical/out-of-scope documentation.
- `Verifier`: retained only in historical/out-of-scope documentation.
- `Institution admin`: retained only in historical/out-of-scope documentation.

### Phase 2 admin-auth implementation verification

Date:
2026-08-06 Africa/Harare

Action:
Started Phase 2 from the Phase 1 VERIFIED state. Added server-safe Supabase config helpers, server user/admin clients, server admin authorization helpers, `/api/admin/session`, Supabase email/password login UI, `/admin` session guard, and pending migration `0003_secure_admin_auth.sql`.

Expected result:
Anonymous users cannot use admin APIs; browser code cannot receive service-role/admin allowlist values; admin authorization requires a verified Supabase Auth user and an active `admin_users` row; production startup requires server-side Supabase admin configuration.

Actual result:
- `CODEX_HOME=C:\Users\User\.codex; codex mcp list` shows the Supabase MCP configured for project `jkafqgdymfiiklmozvhi`, but this Codex runtime exposes no callable Supabase MCP tools and the CLI reports Auth unsupported.
- `.env.local` contains the project publishable/browser Supabase values for `jkafqgdymfiiklmozvhi`, but no `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `MVP_ADMIN_EMAILS`.
- Read-only Supabase Auth settings endpoint for host `jkafqgdymfiiklmozvhi.supabase.co` returned HTTP 200 when tested with the publishable key, confirming the project host is reachable without exposing the key here.
- `/api/admin/session` returns typed `AUTH_REQUIRED`, `FORBIDDEN`, or `DATABASE_UNAVAILABLE` errors and returns only safe user id/email on success.
- Future `/api/admin/*` routes are protected by `requireAdmin` before returning `NOT_IMPLEMENTED`.
- `/admin/login` has no signup path and uses `supabase.auth.signInWithPassword`.
- `/admin` redirects anonymous browser sessions to `/admin/login`, shows a forbidden state for non-admin users, and shows only a minimal verified-admin shell for an active admin.
- `supabase/migrations/0003_secure_admin_auth.sql` is locally tested for `admin_users`, RLS, privilege revokes, and absence of direct browser policies.

Test result:
- `npm test -- adminAuth.test.ts adminMigration.test.ts serverSupabaseConfig.test.ts browserSecretBoundary.test.ts`: passed, 4 test files, 17 tests.
- `npm test -- App.test.tsx adminAuth.test.ts`: passed, 2 test files, 23 tests.
- `npm test`: passed, 18 test files, 96 tests.
- `npm run lint`: passed with the existing five unused-component warnings in `src/App.tsx`: `NextLectureCard`, `AgendaView`, `WeekView`, `TimetableHero`, `SyncWizard`.
- `npm run build`: passed.

Production smoke result with `NODE_ENV=production`, `APP_ENV=production`, `ALLOW_DEMO_DATA=false`, placeholder server Supabase admin env values, and legal env values:
- `/admin/login`: HTTP 200 SPA shell.
- `/admin`: HTTP 200 SPA shell; route tests verify anonymous client guard redirects to `/admin/login`.
- `/dashboard`: HTTP 308 with `Location: /admin`.
- `/api/admin/session`: HTTP 401 JSON error code `AUTH_REQUIRED`.

Bundle/source scan classification:
- Browser bundle contains no `SUPABASE_SERVICE_ROLE_KEY`, `MVP_ADMIN_EMAILS`, `server-secret`, or `service_role`.
- Browser bundle contains Supabase library text `sb_secret_` only as a static key-format detector from `@supabase/supabase-js`, not as a configured value.
- Server bundle contains `SUPABASE_SERVICE_ROLE_KEY` and `MVP_ADMIN_EMAILS` only as server-side environment variable names in `dist-server/server/supabase/*`.
- Tests contain placeholder strings such as `server-secret` only as local assertions; `.env.example` contains empty placeholders only.

## 12. Open blockers

| Exact blocker | Affected phase | Why it blocks progress | Owner | Next concrete action |
|---------------|----------------|------------------------|-------|----------------------|
| Supabase MCP is configured for `jkafqgdymfiiklmozvhi`, but no callable Supabase MCP tools are exposed in this Codex runtime; CLI reports Auth unsupported. | Phase 2 persisted verification and Phase 3 migration planning | Remote migration history, `admin_users` existence, RLS state, and Auth users cannot be inspected or verified. | Operator | Enable callable Supabase MCP tools for this runtime or provide a trusted remote schema/migration export. |
| Server-only Supabase admin env values are not available in the repo environment. | Phase 2 persisted verification | The server-side active-admin lookup requires `SUPABASE_SERVICE_ROLE_KEY`; a real login cannot be verified without safe staging/production server env. | Operator | Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and any pilot bootstrap/admin email config in the target server environment. |
| `0003_secure_admin_auth.sql` has not been applied and no active `admin_users` row has been confirmed. | Phase 2 exit verification | Code tests prove behavior with mocked dependencies, but Phase 2 requires persisted Supabase state before it can be marked VERIFIED. | Operator | Apply the migration to the confirmed Supabase project and provision one active pilot admin row linked to a Supabase Auth user. |

## 13. Next three actions

1. Enable callable Supabase MCP access for project `jkafqgdymfiiklmozvhi` or provide remote schema and migration history.
2. Apply `supabase/migrations/0003_secure_admin_auth.sql` to the confirmed project and verify `admin_users` RLS/privileges remotely.
3. Create or confirm one Supabase Auth pilot admin, set server-only Supabase env values, insert one active `admin_users` row, then run real login/logout/admin/non-admin verification.

## 14. Verification log

### 2026-08-06

- files materially changed: `Progress.md`, `README.md`, `src/App.tsx`, `src/domain/demoConfig.ts`, `server/productionServer.ts`, `server/viteCalendarPlugin.ts`, `tests/App.test.tsx`, `tests/demoDataConfig.test.ts`, `.env.example`, `index.html`, `public/privacy/index.html`, `public/terms/index.html`, `public/data-deletion/index.html`, `public/support/index.html`.
- migrations created/applied: none.
- tests run: `npm test -- demoDataConfig.test.ts`; `npm test -- App.test.tsx`; `npm test`; `npm run lint`; `npm run build`; production build smoke with `ALLOW_DEMO_DATA=false`.
- tests passed/failed: all tests and build passed; lint exited successfully with the unused-component warnings listed above.
- current phase: PHASE 1 — Remove duplicate and mock paths, VERIFIED.
- next action: Start Phase 2 only after confirmation; do not begin authentication, Supabase schema work, UI redesign, or CSS cleanup in this Phase 1 session.
- unresolved blocker: Supabase remote schema/auth inspection unavailable in this session.

### 2026-08-06 Phase 2 continuation

- files materially changed: `Progress.md`, `.env.example`, `server/adminApi.ts`, `server/productionServer.ts`, `server/supabase/adminClient.ts`, `server/supabase/auth.ts`, `server/supabase/config.ts`, `server/supabase/connectivity.ts`, `server/supabase/userClient.ts`, `src/App.tsx`, `src/api/adminSession.ts`, `supabase/migrations/0003_secure_admin_auth.sql`, `tests/App.test.tsx`, `tests/adminAuth.test.ts`, `tests/adminMigration.test.ts`, `tests/browserSecretBoundary.test.ts`, `tests/serverSupabaseConfig.test.ts`.
- migrations created/applied: created `supabase/migrations/0003_secure_admin_auth.sql`; not applied locally or remotely.
- tests run: `npm test -- adminAuth.test.ts adminMigration.test.ts serverSupabaseConfig.test.ts browserSecretBoundary.test.ts`; `npm test -- App.test.tsx adminAuth.test.ts`; `npm test`; `npm run lint`; `npm run build`; production anonymous smoke with `ALLOW_DEMO_DATA=false`.
- tests passed/failed: all tests and build passed; lint exited successfully with five existing unused-component warnings from Phase 1 leftovers.
- production smoke: `/admin/login` 200, `/admin` 200 SPA shell, `/dashboard` 308 to `/admin`, `/api/admin/session` 401 `AUTH_REQUIRED`.
- current phase: PHASE 2 — Secure admin authentication, BLOCKED.
- next action: unblock Supabase remote verification, apply `0003_secure_admin_auth.sql`, provision one active admin user, then verify real persisted login/logout/admin/non-admin behavior.
