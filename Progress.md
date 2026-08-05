# EchoZW Calendar Progress

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
- Fixed EasyPanel Docker deployment by moving the container build/runtime to Node 24.
- Switched production serving from static nginx to a Node server with the calendar API/feed middleware active.
- Added persistent calendar subscription store configuration and `/healthz`.
- Added Google OAuth connect/callback flow that creates a dedicated secondary calendar when credentials are configured.
- Added personalized subscription creation, secure feed tokens, dev/preview `text/calendar` feed responses, Apple webcal gating, Google sync mapping mocks, and a simple MVP admin surface.
- Fixed the EasyPanel Docker build by installing build-time dev dependencies before setting `NODE_ENV=production`.
- Added EchoZW Calendar favicons, PWA icons, manifest metadata, and header branding from the local `branding/` folder.
- Replaced Vite preview deployment with a compiled Node production server that serves `dist/`, `/healthz`, calendar feeds, downloads, and Google OAuth callbacks.
- Allowed the live aiDo calendar hosts through Vite dev/preview host checks for fallback preview deployments.

## Verified

- `npm run lint`
- `npm run test`
- `npm run build`
- Local API smoke test for `POST /api/calendar/subscriptions` and `GET /calendar/feed/<token>.ics`

## Still External

- Live Supabase values.
- Live `PUBLIC_APP_URL` / `VITE_PUBLIC_APP_URL` values and persistent `/data` storage for stable subscription feeds.
- Google OAuth credentials.
- PesePay credentials and official live API details.
- Sentry and PostHog keys.
