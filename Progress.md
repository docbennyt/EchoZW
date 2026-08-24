# CalenderZW Pilot Progress

## 1. Pilot mission

CalenderZW must allow the operator to publish a class-specific university timetable and allow students in that exact class group to add it to their calendars through a personalised .ics download or subscription feed.

The pilot is not yet VERIFIED.

## 2. Pilot completion path

- [x] Secure admin
- [x] Institution persisted
- [x] Programme persisted
- [x] Class group persisted
- [x] Academic period persisted
- [x] Timetable metadata persisted
- [x] Admin timetable editor loads
- [x] Manual sessions persist
- [ ] Publish verified
- [ ] Public link verified
- [ ] Personalised .ics verified
- [ ] Subscription feed verified
- [ ] Republish updates existing feed
- [x] Anonymous users cannot access administration
- [ ] Anonymous users cannot mutate Supabase data
- [x] Mock production data has been removed
- [ ] Full pilot journey has been verified end to end

Manual-entry reliability: BLOCKED
Double-submit protection: BLOCKED
Course memory: BLOCKED
Code autocomplete: BLOCKED
Name autocomplete: BLOCKED
Duplicate workflow: BLOCKED
Real typing-efficiency test: BLOCKED
Non-blocking session save: BLOCKED
Whole-editor reload removed: BLOCKED
Background revalidation: BLOCKED
Day Add remains interactive: BLOCKED
Scroll/context preservation: BLOCKED
Slow-network UX: BLOCKED
Real rapid-entry test: BLOCKED
Public mobile timetable UX: VERIFIED
Above-fold calendar CTA: VERIFIED
Reminder onboarding: VERIFIED
Calendar method onboarding: VERIFIED
Public/private URL separation: VERIFIED
Mobile share loop: VERIFIED
WhatsApp/social metadata: VERIFIED
Compact timetable footer: VERIFIED
Real mobile activation flow: BLOCKED

Live Schedule Sync protected source boundary:
Protected HIT Docs access: VERIFIED
Apps Script structured read: VERIFIED

- 1 document tab
- 5 tables
- document text successfully read
  Remote migration: BLOCKED
- Supabase project `jkafqgdymfiiklmozvhi` does not yet expose `public.timetable_sources`
  Production endpoint: BLOCKED
- live `POST https://calender.aido.co.zw/api/internal/source-snapshots` returned `405 Method not allowed.`
- live `GET https://calender.aido.co.zw/api/internal/source-snapshots` returned the SPA shell
  Source snapshot API: VERIFIED locally / BLOCKED for deployed relay verification
  HMAC authentication: VERIFIED locally / BLOCKED for deployed relay verification
  Server-side hash verification: VERIFIED locally / BLOCKED for deployed relay verification
  Snapshot persistence: VERIFIED in additive schema and repository logic / BLOCKED pending remote migration application
  Remote snapshot: BLOCKED
  Tab count = 1: VERIFIED from protected source read / BLOCKED for remote snapshot proof
  Table count = 5: VERIFIED from protected source read / BLOCKED for remote snapshot proof
  Idempotent retry: VERIFIED in repository and API tests / BLOCKED pending remote database verification
  Same-hash retry: BLOCKED
  Reset-checkpoint retry: BLOCKED
  Real Apps Script forceSync: BLOCKED
  Watcher installed exactly once: BLOCKED

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

| Area                                 | Current implementation                                                                                                                                                                                                                                                                                                                        | Real persistence? | Secure? | Status      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- | ----------- |
| frontend framework                   | React + Vite + TypeScript in `src/App.tsx` with path-based routing from `window.location.pathname`. `/admin` now renders a mobile-first operator workflow backed by protected Node APIs, and `/t/:slug` renders the published timetable plus reminder-driven calendar actions.                                                                | Partial           | Partial | IN PROGRESS |
| production server                    | Node HTTP server in `server/productionServer.ts` serves `dist/`, `/healthz`, protected admin APIs, public timetable API, calendar subscription/feed/download APIs, and SPA shell.                                                                                                                                                             | Partial           | Partial | IN PROGRESS |
| route system                         | Manual route switches in `App`; `/dashboard` redirects client-side to `/admin`; production server returns 308 for `/dashboard`.                                                                                                                                                                                                               | No                | Partial | VERIFIED    |
| Supabase clients                     | Browser publishable-key client remains client-only; server user/admin clients exist in `server/supabase/*`, prefer `SUPABASE_SECRET_KEY`, and accept `SUPABASE_SERVICE_ROLE_KEY` only as a legacy fallback for server admin authorization. Vite `VITE_*` names remain canonical for browser config.                                           | No                | Partial | IN PROGRESS |
| authentication                       | `/admin/login` uses Supabase email/password sign-in, `/admin` checks the browser session with `/api/admin/session`, and admin API routes require a Supabase user plus active `admin_users` row. This was verified against the real browser flow on Friday, August 7, 2026.                                                                    | Supabase          | Yes     | VERIFIED    |
| database schema                      | Remote project `jkafqgdymfiiklmozvhi` was inspected through authorized Supabase MCP. Migrations `secure_admin_auth` and `pilot_mvp_alignment` are applied remotely; MVP tables now expose the fields needed for institutions, programmes, cohorts/class groups, academic periods, timetables, versions, sessions, and calendar subscriptions. | Supabase          | Partial | IN PROGRESS |
| source of public timetable data      | `src/App.tsx` no longer imports `demoTimetable` or `popularTimetables`; timetable links render a truthful unpublished/unavailable state until a Supabase repository exists.                                                                                                                                                                   | No                | Partial | VERIFIED    |
| source of admin timetable data       | The retired mock admin workbench was removed from production route rendering on 2026-08-06; real admin data source is not implemented.                                                                                                                                                                                                        | No                | Partial | VERIFIED    |
| source of .ics data                  | Server .ics download rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when `ALLOW_DEMO_DATA=false`; no client route offers fake .ics download from the unavailable public timetable page.                                                                                                                                          | No                | Partial | VERIFIED    |
| source of subscription-feed data     | `server/viteCalendarPlugin.ts` stores subscriptions in process maps and optional JSON file from `CALENDAR_STORE_PATH`; demo-backed subscription creation/feed/download are disabled unless explicit non-production demo mode is enabled.                                                                                                      | File only         | Partial | VERIFIED    |
| mock data                            | `demoTimetable`, `popularTimetables`, local seed data, tests, and historical docs remain only as fixtures, development/demo mode inputs, or documentation references.                                                                                                                                                                         | No                | Partial | VERIFIED    |
| duplicate dashboards                 | The separate React `/dashboard` component and mock `/admin` workbench were removed from renderable source; stale CSS selectors remain unused.                                                                                                                                                                                                 | No                | Partial | VERIFIED    |
| production environment configuration | `src/domain/demoConfig.ts` defaults demo mode off, accepts only `ALLOW_DEMO_DATA=true`, and forces false whenever runtime mode, `APP_ENV`, or `NODE_ENV` is production.                                                                                                                                                                       | No                | Partial | VERIFIED    |

## 5. Canonical pilot architecture

Public React application -> authenticated/public Node API -> Supabase PostgreSQL -> calendar generation domain -> .ics download and subscription feed.

Supabase PostgreSQL is the canonical source of truth.

## 6. Current phase

Current phase: PHASE 3 — MVP product workflow: IN PROGRESS

## 7. Phase tracker

| Phase                                            | Status      | Entry condition                                              | Exit evidence                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Repository and Supabase audit                 | VERIFIED    | Start from existing repository state and read `Progress.md`. | Local audit recorded on 2026-08-06; Supabase MCP was later authorized and verified against project `jkafqgdymfiiklmozvhi`.                                                                                                                                                                            |
| 1. Remove duplicate/mock production paths        | VERIFIED    | Phase 0 audit recorded.                                      | Public timetable, finder, history, static links, `/dashboard`, `/admin`, calendar subscription creation, .ics download, and calendar feed no longer serve fake timetable/calendar data when `ALLOW_DEMO_DATA=false`. Tests, lint, build, and production smoke evidence recorded below.                |
| 2. Secure admin authentication                   | VERIFIED    | Phase 1 VERIFIED.                                            | MCP, remote schema inspection, migration application, `admin_users` RLS/grants, admin provisioning, secret-boundary canary, tests, lint, build, anonymous 401, non-admin 403, admin 200, inactive-admin 403 then restored 200, and logout 401 are all verified against the real project/browser flow. |
| 3. Create canonical Supabase schema              | IN PROGRESS | Phase 2 VERIFIED.                                            | Remote migration `20260807152043 pilot_mvp_alignment` applied; live CRUD/public verification still pending.                                                                                                                                                                                           |
| 4. Institution/programme/class-group/period CRUD | IN PROGRESS | Phase 3 VERIFIED.                                            | Protected API routes and mobile-first admin screens implemented locally; real persisted operator evidence still pending.                                                                                                                                                                              |
| 5. Timetable draft and session CRUD              | IN PROGRESS | Phase 4 VERIFIED.                                            | Protected timetable/session APIs and draft editor implemented locally; real persisted operator evidence still pending.                                                                                                                                                                                |
| 6. Timetable publication                         | IN PROGRESS | Phase 5 VERIFIED.                                            | Server publish RPC and publish UX implemented; real published timetable evidence still pending.                                                                                                                                                                                                       |
| 7. Public timetable integration                  | IN PROGRESS | Phase 6 VERIFIED.                                            | `/api/public/timetables/:slug` and `/t/:slug` now read published Supabase data only; live published-slug verification still pending.                                                                                                                                                                  |
| 8. Personalised calendar integration             | IN PROGRESS | Phase 7 VERIFIED.                                            | Real DB-backed subscription creation plus feed/download generation implemented; live .ics/feed verification still pending.                                                                                                                                                                            |
| 9. End-to-end pilot verification                 | NOT STARTED | Phase 8 VERIFIED.                                            | Not yet available.                                                                                                                                                                                                                                                                                    |
| 10. Production cleanup                           | NOT STARTED | Phase 9 VERIFIED.                                            | Not yet available.                                                                                                                                                                                                                                                                                    |

## 8. Decisions

| Date       | Decision                                                                                                       | Reason                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-08-06 | `/admin` is the only administration surface.                                                                   | The pilot needs one operator workflow, not competing dashboards.                              |
| 2026-08-06 | `/dashboard` redirects to `/admin`.                                                                            | Existing links may exist, but the route must not render a separate dashboard.                 |
| 2026-08-06 | Student access does not require an account.                                                                    | The pilot flow is anonymous public timetable access plus private calendar links.              |
| 2026-08-06 | One trusted admin role is sufficient for the pilot.                                                            | Representative, verifier, and institution-admin roles are out of scope.                       |
| 2026-08-06 | Manual timetable entry is the primary pilot ingestion method.                                                  | CSV/PDF/DOCX/AI ingestion adds risk before the core flow is verified.                         |
| 2026-08-06 | CSV import is postponed until the manual workflow is verified.                                                 | Import tooling should not define the pilot.                                                   |
| 2026-08-06 | Public timetable data comes only from the current published database version.                                  | Students must see the operator-published version, not fixtures or drafts.                     |
| 2026-08-06 | Production must never fall back to demo data.                                                                  | Empty/error states are safer than false timetable information.                                |
| 2026-08-06 | Demo mode is server-gated by `ALLOW_DEMO_DATA`, `APP_ENV`, and `NODE_ENV`, not by a client-only Vite variable. | Calendar API enforcement must happen on the server and production must force demo mode off.   |
| 2026-08-06 | Google Calendar direct sync remains disabled.                                                                  | The pilot calendar surface is .ics download plus subscription feed.                           |
| 2026-08-07 | `cohorts` remain the database concept while the admin UI uses the term “Class groups”.                         | The remote schema already had `cohorts`; duplicating the concept would add unnecessary drift. |

## 9. Database state

- Applied local migrations: `supabase/migrations/0001_initial_schema.sql`, `supabase/migrations/0002_timetable_import_pipeline.sql` exist in the repo; not re-applied in this session.
- New local migration: `supabase/migrations/0003_secure_admin_auth.sql` creates `public.admin_users` with `user_id`, `active`, `created_at`, `created_by`, `disabled_at`, and `notes`; enables RLS; revokes anon/authenticated table privileges; and adds focused indexes.
- Applied remote migrations: Supabase MCP reports `20260806213828 secure_admin_auth` and `20260807152043 pilot_mvp_alignment`.
- Existing production tables: remote public schema inspected; no `admin_users`, `profiles`, `user_roles`, `roles`, `memberships`, `institution_users`, `admins`, or `permissions` table existed before `secure_admin_auth`.
- Migration drift: remote migration history was empty before this session even though the public schema already contained tables resembling local `0001`/`0002`; treat remote history as drifted and reconcile forward-only.
- Seed-data state: `supabase/seed/demo.sql` inserts a demo institution; no seed command was run this session.
- RLS state: `admin_users` has RLS enabled, no policies, and table ACL limited to `postgres` and `service_role`; direct `anon`/`authenticated` select/insert/update/delete attempts return SQLSTATE `42501`. After `pilot_mvp_alignment`, `institutions`, `programmes`, `cohorts`, `academic_periods`, `timetables`, `timetable_versions`, `timetable_sessions`, and `calendar_subscriptions` have zero public RLS policies and zero direct `anon`/`authenticated` table grants.
- Current admin user state: remote `auth.users` has two confirmed identities. Admin UUID `0a11b91f-4978-43cc-8446-95194ae81fa4` (`d***@gmail.com`) has exactly one active `admin_users` row. Non-admin UUID `773f97e5-46c2-46ec-b8c8-5210801da81b` (`s***@gmail.com`) has no `admin_users` row.

## 10. Route state

| Route                                  | Purpose                            | Authentication                                                           | Data source                                                                                                                     | Status      |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| /                                      | Public home                        | Anonymous                                                                | Static React content; no active sample timetable link                                                                           | VERIFIED    |
| /find                                  | Timetable finder                   | Anonymous                                                                | Link/slug entry for published timetables                                                                                        | IN PROGRESS |
| /t/:slug                               | Public timetable                   | Anonymous                                                                | `/api/public/timetables/:slug` -> current published Supabase version only; add-to-calendar uses real subscription/download APIs | IN PROGRESS |
| /admin/login                           | Admin login                        | Anonymous until form submit                                              | Supabase email/password sign-in; no signup path                                                                                 | IN PROGRESS |
| /admin                                 | Canonical admin surface            | Supabase session plus active `admin_users` row via `/api/admin/session`  | Operator home with recent timetables and setup links                                                                            | IN PROGRESS |
| /admin/institutions                    | Institution management             | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real protected CRUD wired to Supabase                                                                                           | IN PROGRESS |
| /admin/programmes                      | Programme management               | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real protected CRUD wired to Supabase                                                                                           | IN PROGRESS |
| /admin/class-groups                    | Class-group management             | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real protected CRUD wired to Supabase `cohorts`                                                                                 | IN PROGRESS |
| /admin/academic-periods                | Academic-period management         | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real protected CRUD wired to Supabase                                                                                           | IN PROGRESS |
| /admin/timetables                      | Timetable list                     | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real timetable creation flow and recent list                                                                                    | IN PROGRESS |
| /admin/timetables/:id                  | Timetable editor                   | Supabase session plus active `admin_users` row via `/admin/*` guard      | Real draft/session editor with publish action                                                                                   | IN PROGRESS |
| /api/admin/session                     | Admin session validation           | Bearer token verified by Supabase Auth, then active `admin_users` lookup | Returns typed 401/403/503 errors or safe user id/email only                                                                     | IN PROGRESS |
| /calendar/download/:subscriptionId.ics | Personalised .ics download         | Capability weak; enumerable ID                                           | Rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when demo data is disabled                                          | VERIFIED    |
| /calendar/feed/:token.ics              | Private calendar subscription feed | Token hash lookup                                                        | Rejects demo-backed requests with `TIMETABLE_NOT_PUBLISHED` when demo data is disabled                                          | VERIFIED    |
| /api/calendar/subscriptions            | Calendar subscription creation     | Anonymous API                                                            | Rejects demo-backed creation with `TIMETABLE_NOT_PUBLISHED`; no record is created when demo data is disabled                    | VERIFIED    |
| /dashboard                             | Retired dashboard route            | Redirects to `/admin`                                                    | None                                                                                                                            | VERIFIED    |

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

- Earlier local CLI inspection showed Supabase MCP config for project `jkafqgdymfiiklmozvhi`; this was superseded by the later authorized MCP verification below.
- `.env.local` contains the project publishable/browser Supabase values for `jkafqgdymfiiklmozvhi`, but no `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, or legacy `SUPABASE_SERVICE_ROLE_KEY`.
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

- Browser bundle contains no `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `server-secret`, or `service_role`.
- Browser bundle contains Supabase library text `sb_secret_` only as a static key-format detector from `@supabase/supabase-js`, not as a configured value.
- Server bundle contains `SUPABASE_SECRET_KEY` and legacy `SUPABASE_SERVICE_ROLE_KEY` only as server-side environment variable names in `dist-server/server/supabase/*`.

### Phase 3 MVP implementation pass

Date:
2026-08-07 Africa/Harare

Action:
Aligned the live Supabase schema for the MVP, implemented protected admin CRUD/timetable/public/calendar routes, and replaced the minimal verified-admin shell with a mobile-first operator workflow in the React app.

Expected result:
CalenderZW should have one coherent product path for:

- admin setup records;
- timetable draft/session editing;
- publication;
- public timetable viewing;
- personalised `.ics` download and private feed creation;
  with all data flowing through Supabase-backed server endpoints instead of mocks.

Actual result:

- Supabase MCP applied remote migration `20260807152043 pilot_mvp_alignment`.
- Remote `institutions`, `programmes`, `cohorts`, `academic_periods`, `timetables`, `timetable_versions`, `timetable_sessions`, and `calendar_subscriptions` now expose the MVP fields expected by the new repository/API layer.
- Legacy browser-facing policies/grants on those public tables were removed; direct `anon`/`authenticated` table access is no longer granted.
- Added protected server handlers in `server/pilotAdminApi.ts` for:
  - `GET/POST/PATCH /api/admin/institutions`
  - `GET/POST/PATCH /api/admin/programmes`
  - `GET/POST/PATCH /api/admin/class-groups`
  - `GET/POST/PATCH /api/admin/academic-periods`
  - `GET/POST /api/admin/timetables`
  - `GET /api/admin/timetables/:id`
  - `POST/PATCH/DELETE /api/admin/timetables/:id/sessions`
  - `POST /api/admin/timetables/:id/publish`
- Added public server handlers:
  - `GET /api/public/timetables/:slug`
  - `POST /api/calendar/subscriptions`
  - `GET /calendar/download/:subscriptionId.ics`
  - `GET /calendar/feed/:token.ics`
- Added real published-timetable ICS generation in `server/publishedCalendar.ts`.
- Replaced the `/admin` shell with:
  - overview/home;
  - institutions/programmes/class groups/academic periods CRUD screens;
  - timetable creation flow;
  - timetable session editor with add/edit/delete/duplicate;
  - publish success link actions.
- Replaced the `/t/:slug` placeholder with a real published timetable view and reminder-driven calendar actions.
- Replaced `/find` with a shared-link/slug entry flow for published timetables.

Real persisted evidence:

- Not yet recorded in this session for institution/programme/class-group/academic-period/timetable/session/publication/feed rows created through the authenticated operator UI.
- This means the MVP implementation is real in code and remote schema, but the end-to-end pilot journey is still awaiting live operator/browser execution and database confirmation.

Test result:

- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 20 test files, 102 tests.
- `npx vitest run tests/App.test.tsx`: passed, 15 tests.
- Tests contain placeholder strings such as `server-secret` only as local assertions; `.env.example` contains empty placeholders only.

### Phase 2 real Supabase verification

Date:
2026-08-06 Africa/Harare

Action:
Used the now-authorized Supabase MCP against the actual CalenderZW project, performed read-only discovery before migration, applied only the Phase 2 `admin_users` migration, verified the resulting database state, removed unused `MVP_ADMIN_EMAILS` bootstrap scaffolding, removed obsolete Phase 1 timetable/sync components, and reran the verification suite.

Remote discovery:

- Supabase MCP: VERIFIED.
- Project URL confirmed by MCP: `https://jkafqgdymfiiklmozvhi.supabase.co`.
- Project ref confirmed from MCP URL: `jkafqgdymfiiklmozvhi`.
- Remote migration history before this session: empty.
- Remote public schema before `secure_admin_auth`: timetable/import/calendar tables existed, all with zero rows in the inspected table summary.
- No pre-existing admin authority table found for `admin_users`, `profiles`, `user_roles`, `roles`, `memberships`, `institution_users`, `admins`, or `permissions`.
- Remote policies before this session used some legacy `auth.jwt()->app_metadata.role` import-admin concepts for import tables, but no table provided the Phase 2 active-admin authority semantics.
- Remote function discovery found `public.rls_auto_enable()` as a public `SECURITY DEFINER` event-trigger helper; it is unrelated to Phase 2 admin authorization and is listed by Supabase advisors as callable by anon/authenticated. It was not changed in this Phase 2 pass.
- Remote Auth users at that time: zero rows in `auth.users`; superseded by the 2026-08-07 identity check below.

Migration result:

- Applied migration through MCP as `20260806213828 secure_admin_auth`.
- Post-apply verification confirmed `public.admin_users` exists.
- Columns verified: `user_id uuid not null`, `active boolean not null default true`, `created_at timestamptz not null default now()`, `created_by uuid`, `disabled_at timestamptz`, `notes text`.
- Constraints verified: primary key on `user_id`; `user_id` foreign key references `auth.users(id) on delete cascade`; `created_by` foreign key references `auth.users(id) on delete set null`.
- RLS verified enabled.
- Policies verified: none.
- Grants verified: ACL contains `postgres` and `service_role`; anon/authenticated grants are absent.
- Service-role path verified by role simulation: `service_role` can select `count(*)` from `admin_users`.
- Ordinary-client denial verified by direct role simulation: anon SELECT and INSERT return SQLSTATE `42501`; authenticated SELECT, INSERT, UPDATE, and DELETE return SQLSTATE `42501`.

Phase 2 verification matrix:

| Capability                      | Status   | Evidence                                                                                                                                                                                                 |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase MCP authorized         | VERIFIED | `get_project_url` returned `https://jkafqgdymfiiklmozvhi.supabase.co`.                                                                                                                                   |
| Supabase project reachable      | VERIFIED | MCP listed migrations/tables and executed read-only SQL.                                                                                                                                                 |
| Supabase Auth reachable         | VERIFIED | MCP inspected `auth.users`; Auth logs show `/settings` HTTP 200.                                                                                                                                         |
| Remote schema inspected         | VERIFIED | Public/auth tables, policies, grants, functions, and migration history inspected.                                                                                                                        |
| `admin_users` migration applied | VERIFIED | MCP migration `20260806213828 secure_admin_auth`.                                                                                                                                                        |
| `admin_users` RLS               | VERIFIED | RLS enabled; no ordinary-client policies.                                                                                                                                                                |
| Login implementation            | VERIFIED | UI/tests use `supabase.auth.signInWithPassword`; real browser login then server authorization was observed.                                                                                              |
| Anonymous API 401               | VERIFIED | Real browser/API verification observed `401`.                                                                                                                                                            |
| Non-admin API 403               | VERIFIED | Real browser/API verification observed `403` for the non-admin account.                                                                                                                                  |
| Admin API 200                   | VERIFIED | Real browser/API verification observed `200` for the authorized admin account.                                                                                                                           |
| Inactive admin rejected         | VERIFIED | `admin_users.active` was temporarily set `false`; the already-authenticated admin browser session then observed `403`; the row was restored to `active=true`.                                            |
| Logout invalidates access       | VERIFIED | Real browser flow observed logout followed by `401`.                                                                                                                                                     |
| Browser secret isolation        | VERIFIED | Canary build with `SUPABASE_SECRET_KEY=CALENDERZW_SUPABASE_SECRET_CANARY_20260807` and legacy `SUPABASE_SERVICE_ROLE_KEY=CALENDERZW_LEGACY_SERVICE_CANARY_20260807`; exact canaries absent from `dist/`. |
| Self-promotion denied           | VERIFIED | Authenticated role SELECT/INSERT/UPDATE/DELETE against `admin_users` returned SQLSTATE `42501`.                                                                                                          |

Test result:

- `npm test`: passed, 18 test files, 97 tests.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed; Vite output `dist/assets/index-CjgrtNQB.js` 457.35 kB, gzip 130.26 kB.

Production smoke result with `NODE_ENV=production`, `APP_ENV=production`, `ALLOW_DEMO_DATA=false`, placeholder server Supabase admin env values, and legal env values:

- `/admin/login`: HTTP 200 SPA shell.
- `/admin`: HTTP 200 SPA shell; raw shell had no matches for `admin_users`, canary values, privileged env names, placeholder service key, `access_token`, or `refresh_token`.
- `/dashboard`: HTTP 308 with `Location: /admin`.
- `/api/admin/session`: HTTP 401 JSON error code `AUTH_REQUIRED`.

Cleanup:

- Removed obsolete `NextLectureCard`, `AgendaView`, `WeekView`, `TimetableHero`, `SyncWizard`, and the now-unused `MessageDialog` helper from `src/App.tsx`.
- Removed unused `MVP_ADMIN_EMAILS` bootstrap parser/config/test/env placeholder; the only administrator authority mechanism is now `admin_users`.

## 12. Open blockers

None for Phase 2.

## 13. Next three actions

1. Review Phase 2 evidence and approve the verified exit state.
2. Prepare the scoped instruction for Phase 3 only after that review.
3. Keep the current admin authority model unchanged until Phase 3 begins.

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

### 2026-08-06 Phase 2 real Supabase continuation

- files materially changed: `Progress.md`, `.env.example`, `server/supabase/config.ts`, `src/App.tsx`, `tests/browserSecretBoundary.test.ts`, `tests/serverSupabaseConfig.test.ts`.
- remote MCP result: Supabase MCP authorized and verified against project `jkafqgdymfiiklmozvhi`.
- remote migration result: applied `20260806213828 secure_admin_auth`; verified `public.admin_users` columns, FK constraints, RLS, no policies, and no anon/authenticated privileges.
- remote auth state at that time: `auth.users` had zero rows and `admin_users` had zero rows; superseded by the 2026-08-07 identity check below.
- RLS/self-promotion evidence: anon SELECT/INSERT and authenticated SELECT/INSERT/UPDATE/DELETE on `admin_users` returned SQLSTATE `42501`; `service_role` SELECT count succeeded.
- tests run: `npm test`; `npm run lint`; `npm run build` with canary env; production anonymous smoke with `ALLOW_DEMO_DATA=false`.
- tests passed/failed: `npm test` passed, 18 files and 95 tests; `npm run lint` passed with zero warnings; `npm run build` passed.
- canary evidence: exact `SUPABASE_SERVICE_ROLE_KEY` canary and `MVP_ADMIN_EMAILS` canary strings were absent from `dist/`; browser source/assets do not reference server Supabase modules or privileged env names.
- production smoke: `/admin/login` 200, `/admin` 200 SPA shell with no privileged marker leaks, `/dashboard` 308 to `/admin`, `/api/admin/session` 401 `AUTH_REQUIRED`.
- removed: obsolete Phase 1 timetable/sync components and unused `MVP_ADMIN_EMAILS` bootstrap scaffolding.
- current phase: PHASE 2 — Secure admin authentication, BLOCKED.
- remaining blocker at that time: no real Supabase Auth admin/non-admin identities existed and no server-side privileged runtime key was available for app-server persisted auth verification.

### 2026-08-07 Phase 2 identity check

- remote MCP result: `auth.users` now contains two confirmed identities.
- admin identity: UUID `0a11b91f-4978-43cc-8446-95194ae81fa4`, redacted email `d***@gmail.com`, active admin row present.
- non-admin identity: UUID `773f97e5-46c2-46ec-b8c8-5210801da81b`, redacted email `s***@gmail.com`, no `admin_users` row.
- admin provisioning result: no insertion was needed in this session because exactly one intended active admin row already existed; verified total admin rows = 1 and active admin rows = 1.
- local runtime env check at that time: current shell and `.env.local` did not expose `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`; no secrets were printed.
- tests run: not rerun in this gate because no application code changed and Phase 2 remains blocked before real app-server login verification.
- current phase: PHASE 2 — Secure admin authentication, BLOCKED.
- remaining blocker at that time: run the Node server with server-only privileged Supabase env and complete real admin/non-admin login sessions without exposing passwords.

### 2026-08-07 Phase 2 secret-key model update

- files materially changed: `.env.example`, `Progress.md`, `server/supabase/adminClient.ts`, `server/supabase/config.ts`, `tests/browserSecretBoundary.test.ts`, `tests/serverSupabaseConfig.test.ts`.
- server key model: privileged server resolution now prefers `SUPABASE_SECRET_KEY` and falls back to legacy `SUPABASE_SERVICE_ROLE_KEY`; browser config remains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- remote auth confirmation: admin UUID `0a11b91f-4978-43cc-8446-95194ae81fa4` (`d***@gmail.com`) still has the only active admin row; non-admin UUID `773f97e5-46c2-46ec-b8c8-5210801da81b` (`s***@gmail.com`) still has no `admin_users` row.
- runtime env check: current shell does not have `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, or legacy `SUPABASE_SERVICE_ROLE_KEY`; no secret values were printed.
- tests run: `npm test`; `npm run lint`; `npm run build` with `SUPABASE_SECRET_KEY=CALENDERZW_SUPABASE_SECRET_CANARY_20260807` and legacy `SUPABASE_SERVICE_ROLE_KEY=CALENDERZW_LEGACY_SERVICE_CANARY_20260807`.
- tests passed/failed: `npm test` passed, 18 files and 97 tests; `npm run lint` passed with zero warnings; `npm run build` passed.
- canary evidence: exact 2026-08-07 preferred and legacy secret canary strings were absent from `dist/`; browser source/assets do not reference `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or server Supabase modules.
- current phase: PHASE 2 — Secure admin authentication, BLOCKED.
- remaining blocker: the real privileged runtime is not present in this shell, and no usable authenticated admin/non-admin sessions are available here for the required 403/200/inactive/logout verification.

### 2026-08-07 Phase 2 dev-runtime `/api/admin/session` 500 fix

- files materially changed: `Progress.md`, `.env.example`, `vite.config.ts`, `server/adminApi.ts`, `server/supabase/auth.ts`, `server/viteCalendarPlugin.ts`, `tests/adminAuth.test.ts`, `tests/viteServerAuthDeps.test.ts`.
- concrete browser symptom: Supabase password login returned HTTP 200, then `GET /api/admin/session` returned HTTP 500 and the UI showed `Administrator sign-in is temporarily unavailable.`.
- local env presence check: `.env.local` contains `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`; the interactive shell process environment itself did not contain those keys.
- exact root cause: Vite dev middleware was resolving admin authorization from bare `process.env`, so the browser could authenticate with Supabase while the server-side admin lookup lacked injected `SUPABASE_URL` / `SUPABASE_SECRET_KEY` and failed as `AUTH_CONFIGURATION_ERROR`.
- fix applied: `vite.config.ts` now uses `loadEnv(mode, process.cwd(), "")`; the loaded server env is injected into `calendarMvpPlugin(...)`; the plugin now builds server auth dependencies with that env and passes them into `handleAdminRequest(...)`; calendar middleware env reads were also switched to the injected runtime env; `server/adminApi.ts` now logs only safe admin failure codes; auth configuration errors now return the safe message `Administrator authentication is temporarily unavailable.`.
- secret boundary verification: after the Vite env-loading fix, `SUPABASE_SECRET_KEY=CALENDERZW_DEV_SERVER_SECRET_CANARY_20260807` and `SUPABASE_SERVICE_ROLE_KEY=CALENDERZW_LEGACY_SERVICE_CANARY_20260807` were used for a test build and exact canary strings were absent from `dist/`.
- test result: `npm test` passed, 20 files and 102 tests; `npm run lint` passed; `npm run build` passed.
- bounded tooling note: an earlier dev smoke command hung and is treated as tooling failure, not app evidence. Existing smoke logs showed orphaned Vite listeners on ports `4175` and `4176`; those node processes were terminated. No long-running dev-server smoke result is claimed from that attempt.
- current phase: PHASE 2 — Secure admin authentication, BLOCKED.
- remaining blocker: the code-level 500 diagnosis is complete and fixed, but the required live browser verification for anonymous 401, non-admin 403, admin 200, inactive-admin 403 then restored 200, and logout 401 has not yet been observed in this shell.

### 2026-08-07 Phase 2 final real-browser and database-authority verification

- browser evidence supplied by the operator from the real browser flow:
  - anonymous `/api/admin/session` -> `401`
  - authenticated non-admin `/api/admin/session` -> `403`
  - authenticated admin `/api/admin/session` -> `200`
  - logout -> subsequent protected API request `401`
- database-authority test executed through authorized Supabase MCP against project `jkafqgdymfiiklmozvhi`:
  - confirmed admin Auth UUID `0a11b91f-4978-43cc-8446-95194ae81fa4`
  - confirmed its `public.admin_users` row existed and was initially `active=true`
  - temporarily updated that row to `active=false` with `disabled_at` set
  - operator refreshed the already-authenticated admin browser session and confirmed inactive-admin `/api/admin/session` -> `403`
  - immediately restored the same row to `active=true` and `disabled_at=null`
  - post-restore MCP verification confirmed exactly one admin row remains, the UUID is unchanged (`0a11b91f-4978-43cc-8446-95194ae81fa4`), and all admin rows are active
- final Phase 2 state:
  - anonymous `401`: VERIFIED
  - non-admin `403`: VERIFIED
  - admin `200`: VERIFIED
  - inactive admin `403`: VERIFIED
  - restored admin authority: VERIFIED
  - logout `401`: VERIFIED
- current phase: PHASE 2 — Secure admin authentication, VERIFIED.
- next action: stop here; do not start Phase 3 in this run.

### 2026-08-09 Manual-entry reliability hardening

- files materially changed: `Progress.md`, `server/pilotRepository.ts`, `src/api/pilotTypes.ts`, `src/domain/courseMemory.ts`, `src/pilotMvp.tsx`, `src/styles.css`, `tests/courseMemory.test.ts`, `tests/timetableEditor.test.tsx`.
- operator-reported real symptom before this pass: first save tap appeared stuck, a second tap closed the dialog, and repeated Tuesday `ICS` rows were visible in the draft timetable.
- code-level root cause identified:
  - client save flow allowed a second submit before React disabled the button, so rapid repeat taps could enqueue duplicate creates;
  - server exact-duplicate detection compared browser `HH:MM` values against database `HH:MM:SS` values, so retried identical creates could bypass the duplicate guard;
  - new draft sessions used non-deterministic `stable_session_key` values, reducing safe create-retry recovery.
- fix applied:
  - timetable session save now uses a synchronous in-flight ref guard plus disabled pending actions so one submit path can run at a time;
  - successful saves update local editor state immediately, sort sessions deterministically, close or reset the drawer intentionally, and keep newly learned course memory in editor state without reload;
  - duplicate opens a prefilled unsaved form only and does not persist until explicit save;
  - course code and course name inputs now behave as linked local comboboxes backed by bounded editor-loaded course memory with conservative lecturer/session-type prefill and venue suggestion chips;
  - server session create now normalizes time values, uses deterministic `stable_session_key` generation, and returns an existing exact duplicate row instead of creating a second one when the same create is retried.
- focused verification:
  - `npm test -- courseMemory.test.ts`: passed.
  - `npm test -- timetableEditor.test.tsx`: passed.
  - `npm test -- pilotRepository.test.ts`: passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.
- remaining blocker:
  - independent Supabase MCP verification of the currently duplicated Tuesday draft rows and any real-row cleanup was not completed in this pass because remote MCP usage was unavailable.
- current status for this pass:
  - Manual-entry reliability: BLOCKED pending real browser retest plus Supabase row verification.
  - Double-submit protection: BLOCKED pending rapid-tap verification against the real draft.
  - Course memory: BLOCKED pending real typing-efficiency verification in the live editor.

### 2026-08-09 Non-blocking timetable-entry state model

- files materially changed: `Progress.md`, `server/pilotAdminApi.ts`, `src/api/pilotAdmin.ts`, `src/api/pilotTypes.ts`, `src/pilotMvp.tsx`, `src/styles.css`, `tests/timetableEditor.test.tsx`.
- code-level root cause identified:
  - the timetable editor used one global loading path for editor fetches, so any later `loadEditor()` call could replace the whole editor with the initial loading state instead of treating refresh as background work;
  - session mutation flows had local reconciliation, but there was no explicit background-refresh state model or stale-request protection around follow-up timetable fetches.
- fix applied:
  - split editor fetch state into initial-load vs background-refresh semantics;
  - added a first-load skeleton for the editor and preserved the mounted editor once usable data exists;
  - session create/edit/delete now reconcile the confirmed returned record locally, keep weekday ordering deterministic, and trigger non-blocking background revalidation;
  - background refresh now surfaces only a small `Syncing...` indicator plus a safe subtle warning if revalidation fails after a confirmed save/delete/publish;
  - added latest-request-wins protection so an older timetable GET cannot overwrite a newer mutation state;
  - delete API now returns `deletedSessionId`, allowing targeted local removal without a whole-editor reload;
  - add-button focus targets are retained so ordinary modal close/save returns context to the relevant weekday control.
- focused verification:
  - `npm test -- timetableEditor.test.tsx`: passed, 8 tests.
  - `npm test -- pilotAdminApi.test.ts`: passed, 3 tests.
  - `npm test`: passed, 25 files and 121 tests.
  - `npm run lint`: passed.
  - `npm run build`: passed.
- current status for this pass:
  - Non-blocking session save: BLOCKED pending real operator/browser verification on the live draft timetable.
  - Whole-editor reload removed: BLOCKED pending live browser confirmation after real add/edit/delete actions.
  - Background revalidation: BLOCKED pending live browser/network observation.
  - Day Add remains interactive: BLOCKED pending live browser verification during real background refresh.
  - Scroll/context preservation: BLOCKED pending live browser verification on lower weekday sections.
  - Slow-network UX: BLOCKED pending throttled live browser verification.
  - Real rapid-entry test: BLOCKED pending live three-class manual entry confirmation against Supabase.
