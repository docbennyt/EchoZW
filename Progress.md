# Echo Calender Progress

## Completed

- Initialized a React/Vite/TypeScript app.
- Built the public student QR/shared-link timetable flow.
- Added reminder presets, `.ics` generation, subscription-link copy, calendar-provider instructions, sharing, and correction reporting.
- Added finder, history, and pilot dashboard routes.
- Added domain tests, docs, CI, Supabase schema starter, and provider interfaces for PesePay and future AI extraction.
- Refined the drawer back into a compact three-step flow to avoid long mobile scrolling while keeping provider choice explicit.
- Added visible Google, Apple, Download, and copy-link calendar actions on the provider step.
- Added request/upload forms and admin-visible submission records.
- Added admin lecture CRUD controls for class entries.
- Added personalized subscription creation, secure feed tokens, dev/preview `text/calendar` feed responses, Apple webcal gating, Google sync mapping mocks, and a simple MVP admin surface.

## Verified

- `npm run lint`
- `npm run test`
- `npm run build`
- Local API smoke test for `POST /api/calendar/subscriptions` and `GET /calendar/feed/<token>.ics`

## Still External

- Live Supabase values.
- Production subscribed-feed server route.
- Google OAuth credentials.
- PesePay credentials and official live API details.
- Sentry and PostHog keys.
