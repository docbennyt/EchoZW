# Architecture Remediation Plan

Date: 2026-08-06

## Goal

Move CalenderZW from a fixture-backed Vite MVP to one secure Supabase-backed product where public users read only published timetable projections and authenticated administrators manage drafts, versions, publication, imports, calendar feeds, reports, sync jobs, and audit logs through authorized server operations.

## Non-Negotiables

- Do not re-enable admin controls until Supabase Auth and server-side role checks exist.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` through any `VITE_`, `PUBLIC_`, or browser-visible variable.
- Do not apply destructive migrations or reset a linked remote project.
- Do not claim production readiness while public pages, calendar feeds, or Google sync still import `demoTimetable`.

## Phase 1: Audit and Containment

Status: started.

- Completed local route/data audit.
- Retired client-visible MVP admin login.
- Routed `/admin/*` to a blocked setup state.
- Documented the Supabase MCP access blocker.
- Next: move `/admin/google-verification-readiness` to a non-admin diagnostics path or protect it.

## Phase 2: Supabase Reconciliation

Prerequisite: working Supabase MCP or CLI access to the intended project.

- Inspect linked project id, migration table, auth settings, schemas, storage buckets, policies, functions, triggers, and indexes.
- Compare remote schema with `supabase/migrations`.
- Pull remote schema into a review branch if drift exists.
- Create additive migrations only; avoid destructive changes until production data is classified.

## Phase 3: Canonical Schema

Add versioned migrations for:

- Identity and access: `profiles`, `user_roles`, role enums/checks, bootstrap audit.
- Academic model: `institutions`, `campuses`, `faculties`, `departments`, `programmes`, `cohorts`, `academic_periods`, `academic_breaks`, `courses`, `programme_courses`.
- Timetable model: `timetables`, `timetable_versions`, `timetable_sessions`, `timetable_session_exceptions`, publication metadata.
- Reports and observability: `timetable_reports`, `audit_logs`, analytics events.
- Calendar: `calendar_subscriptions`, `google_calendar_connections`, `calendar_event_sync_records`, `calendar_sync_jobs`.

Use constraints for date/time validity, unique slugs/codes, immutable published versions, and stable session keys. Add indexes for public slug lookup, institution-scoped admin lists, feed-token lookup, and pending sync jobs.

## Phase 4: RLS and Authorization

- Enable RLS on every exposed table.
- Add helper functions with safe `search_path`:
  - `current_user_has_role(required_role text, target_institution_id uuid)`
  - `current_user_can_edit_institution(target_institution_id uuid)`
  - `current_user_can_publish_institution(target_institution_id uuid)`
- Anonymous users can read active public catalogue rows and current published timetable projections only.
- Editors can draft within assigned institutions only.
- Institution admins can publish within assigned institutions only.
- Platform admins can manage global roles and cross-institution operations.
- Audit logs and role tables remain private.

## Phase 5: Supabase Client Separation

- Browser client: anon/publishable key only, RLS-bound.
- Server user-context client: session-bound, RLS-bound.
- Server admin client: service-role key, server-only module, narrow privileged operations.
- Add a test scanning frontend source for service-role references and public secret prefixes.

## Phase 6: Admin Application

- Keep one `/admin` hierarchy.
- Build `AdminShell` with identity, role, institution scope, environment, navigation, sign-out, and status messaging.
- Implement `/admin/login`, `/admin/logout`, and `/auth/callback` with Supabase Auth.
- Add role management for `platform_admin` after bootstrap.
- Implement CRUD in this order: institutions, programmes, courses, programme-course associations, cohorts, academic periods, timetables, versions, sessions.

## Phase 7: Transactional Operations

Implement server endpoints or RPC functions for:

- assign role;
- create draft version from published version;
- confirm CSV import;
- publish timetable;
- archive programme;
- revoke subscription;
- disconnect Google;
- enqueue sync jobs.

Each operation must authenticate, authorize, validate, execute atomically where needed, return typed domain errors, and write audit logs.

## Phase 8: Public Projections

- Replace `demoTimetable` imports in public routes with database-backed loaders.
- Resolve public timetable by slug.
- Return unavailable states when no current published version exists.
- Ensure drafts, rejected versions, and unpublished sessions are not readable anonymously.
- Preserve the current public slug by migrating the demo timetable only as clearly marked demo/pilot data if intentionally retained.

## Phase 9: Calendar and Google Sync

- Refactor `.ics` and webcal feeds to read current published version, sessions, exceptions, and reminder preferences from Supabase.
- Generate stable event UIDs from timetable/session identity, not random version-local ids.
- Add `calendar_sync_jobs` with idempotency keys and status lifecycle.
- Move Google updates out of OAuth callback/publication transactions into a durable worker or secured cron endpoint.

## Phase 10: Tests and Release Gates

- Unit tests for domain validation, stable session keys, errors, CSV parsing, calendar UID/sequence behavior.
- Integration tests for auth, admin APIs, publication transaction, public loaders, and feed generation.
- RLS tests using real Supabase/local Postgres contexts.
- E2E tests for admin publish flow, CSV import flow, and anonymous access denial.
- Required commands before release: `npm run lint`, `npm test`, `npm run build`, migration apply against staging, RLS test suite, staging smoke test.

## Immediate Next Implementation Slice

1. Add Supabase dependency and environment validation.
2. Add server-only Supabase client modules and frontend secret-scan test.
3. Add canonical additive migration for profiles, roles, audit logs, and core academic/timetable tables.
4. Add RLS helper functions and initial policies.
5. Replace blocked admin page with real Supabase login only after server-side session and role checks are working.
