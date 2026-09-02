# DR-52 — Google Calendar deterministic sync

## Problem

Google Calendar subscriptions added via **From URL** are pull-based. CalenderZW cannot force Google's external-calendar crawler to refresh immediately when a Class Rep publishes an urgent correction. A browser refresh in Google Calendar does not necessarily trigger a server-side fetch of the private CalenderZW feed.

This makes URL subscriptions a useful fallback but insufficient as CalenderZW's primary Google reliability path.

## Production evidence

- Apple subscription fetched the corrected feed and updated.
- The most recently active WebCal subscription for CS 1.1 had not fetched again after the latest correction/revision repair at the time of investigation.
- The Google Calendar account connected during debugging did not expose a current `calender.aido.co.zw` external calendar; the only visible imported calendar was an obsolete localhost demo URL. This indicates onboarding/account-state ambiguity can compound Google's polling delay.

## Required product path

Implement production Google Calendar OAuth/API sync using the canonical resolved CalenderZW schedule.

- Dedicated secondary CalenderZW calendar; never write into primary.
- Server-side OAuth state validation.
- Encrypted refresh-token storage only.
- Use the same resolved schedule that powers public timetable, Tomorrow, Next Class and ICS.
- Upsert events by stable logical session identity.
- Class Rep modify keeps the same event identity and updates title/time/venue.
- Add/remove/cancel/move/extra occurrences reconcile idempotently.
- Trigger sync after a committed timetable correction/publication; network failure must not roll back timetable truth.
- Retry transient Google failures and surface disconnected/invalid-grant state.
- Keep private URL subscription as fallback.
- No secrets/tokens/endpoints in analytics or browser logs.

## Acceptance

A Class Rep modifies Monday 14:00 from ICS1101 Principles of Programming Languages to ICS1102 Operating System. An already-connected Google Calendar receives the update through Google Calendar API without waiting for Google's external URL polling cycle or requiring resubscription.
