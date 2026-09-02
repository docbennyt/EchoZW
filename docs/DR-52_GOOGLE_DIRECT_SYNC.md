# DR-52 — Deterministic Google Calendar sync

Google Calendar subscriptions added with **From URL** are pull-based and CalenderZW cannot force Google's external-calendar crawler to refresh on a Class Rep correction. This is a valid fallback, not a sufficient primary path for urgent timetable truth.

## Required production behavior

Implement production Google Calendar OAuth/API sync from the same canonical resolved schedule used by the public timetable, Tomorrow, Next Class and ICS.

- Create a dedicated secondary CalenderZW calendar; never write into the user's primary calendar.
- Validate OAuth state server-side.
- Persist refresh tokens encrypted server-side only.
- Upsert events by stable logical session identity.
- A Class Rep `modify` keeps the event identity and updates title/time/venue.
- Reconcile add/remove/cancel/move/extra occurrences idempotently.
- Trigger/retry sync after committed resolved-schedule changes; Google network failure must not roll back timetable truth.
- Keep URL subscription as fallback.
- Never place OAuth tokens, private feed URLs, phone numbers or secrets in logs/analytics.

## Acceptance

An already-connected Google student receives a Class Rep change from Monday 14:00 ICS1101 Principles of Programming Languages to ICS1102 Operating System without resubscribing or waiting for Google's external-feed polling cycle.
