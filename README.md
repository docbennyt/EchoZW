# EchoZW Calendar

EchoZW Calendar is an EchoZW family app by [aiDo](https://aido.co.zw). It helps students open a verified timetable from a QR code or shared link, preview lectures on a small phone, choose useful reminders, and add the timetable to their calendar without creating an account.

## Stack

- React and Vite
- TypeScript strict mode
- Zod validation
- Vitest and Testing Library
- CSS design tokens
- Mocked provider interfaces for PesePay and future AI extraction

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5173/find` to see the published timetable entry point. Until a real timetable repository is implemented, fixture-backed timetable links render an unavailable state instead of demo classes.

Google and Apple Calendar subscriptions need a public HTTPS app URL. Use the local `.ics` download for direct testing, or set `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL` to the live deployment URL for provider subscription testing.

## Environment Variables

Copy `.env.example` to `.env.local` and fill values as needed:

- `VITE_APP_BASE_URL`
- `VITE_SUPPORT_EMAIL`
- `VITE_ENABLE_GOOGLE_CALENDAR_SYNC`
- `VITE_ENABLE_PESEPAY_CHECKOUT`
- `VITE_ENABLE_PREMIUM_FEATURES`
- `VITE_ENABLE_PRIVATE_TIMETABLES`
- `VITE_ENABLE_DOCUMENT_UPLOADS`
- `VITE_ENABLE_AI_EXTRACTION`
- `VITE_ENABLE_INSTITUTION_BRANDING`
- `VITE_ENABLE_WEB_PUSH`
- `VITE_ENABLE_WHATSAPP_NOTIFICATIONS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PESEPAY_INTEGRATION_KEY`
- `PESEPAY_ENCRYPTION_KEY`
- `PESEPAY_WEBHOOK_SECRET`
- `PESEPAY_RETURN_URL`
- `PESEPAY_RESULT_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Commands

```bash
npm run build
npm run test
npm run lint
npm run format:check
```

## Known Limitations

- This Vite pilot no longer generates calendar files from demo timetable data in production paths. A production subscribed feed needs the server API to read published timetable rows from Supabase.
- Supabase, Google Calendar, PesePay, Sentry, and PostHog are scaffolded or documented, not live-connected without credentials.
- Fictional seed data remains for local development and tests only.

## Deployment

1. Set `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL` to the live HTTPS origin.
2. Run `npm run build`.
3. Run `npm run preview` or `node dist-server/server/productionServer.js` so the calendar API and `.ics` feed routes stay active.
4. Mount persistent storage at `/data` or set `CALENDAR_STORE_PATH` to a writable persistent file.
5. Set Google OAuth credentials when direct Google Calendar sync is enabled.
