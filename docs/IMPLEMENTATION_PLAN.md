# Implementation Plan

## Assumptions

- The user requested React and Vite, so the pilot is implemented as a Vite SPA instead of the master prompt's recommended Next.js app.
- Live Supabase, Google OAuth, PesePay, Sentry, PostHog, and production hosting credentials are not available in this workspace.
- The first production-worthy milestone is the public student calendar-sync flow. Administrative and billing surfaces are scaffolded for pilot planning.

## Phase 1 Foundation

- Create React, Vite, TypeScript, ESLint, Vitest, and deployment-ready configuration.
- Centralise product, company, URLs, timezone, currency, and feature flags.
- Add seed timetable data for aiDo Demo University.

## Phase 2 Timetable Core

- Model timetable, versions, verification states, correction reports, and events.
- Provide public timetable, finder, agenda, week preview, history, reporting, and dashboard screens.

## Phase 3 Calendar Delivery

- Generate RFC 5545-style `.ics` content with stable UIDs, recurrence, exclusions, alarms, escaping, and line folding.
- Provide browser download and copyable feed URL. Dynamic subscribed feeds require a server or edge function.

## Phase 4 Student Experience

- Build a three-step sync wizard: confirm timetable, choose reminders, choose calendar.
- Keep public viewing and download account-free.

## Phase 5 Administration

- Scaffold representative, verifier, and institution dashboard actions.
- Document role and RLS policies for Supabase.

## Phase 6 Billing

- Add PesePay provider interface and safe mock adapter. No fake live success responses.

## Phase 7 Optional Calendar API

- Keep direct Google sync behind a feature flag until OAuth credentials are supplied.
