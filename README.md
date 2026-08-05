# Echo Calender

Echo Calender is an EchoZW family app by [aiDo](https://aido.co.zw). It helps students open a verified timetable from a QR code or shared link, preview lectures on a small phone, choose useful reminders, and add the timetable to their calendar without creating an account.

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

Open `http://localhost:5173/t/zou-bscse-2-1-2026-s2`.

Google and Apple Calendar cannot fetch localhost feed URLs. Use the local `.ics` download for direct testing, or set `VITE_PUBLIC_APP_URL` to a public HTTPS preview/tunnel URL for provider subscription testing.

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

- This Vite pilot generates downloadable `.ics` files in the browser. A production subscribed feed needs a server or edge function that returns `text/calendar`.
- Supabase, Google Calendar, PesePay, Sentry, and PostHog are scaffolded or documented, not live-connected without credentials.
- The seed data is fictional and safe for demos.

## Deployment

1. Set environment variables in the hosting provider.
2. Run `npm run build`.
3. Deploy `dist/` to Vercel, Cloudflare Pages, Netlify, or equivalent static hosting.
4. Add server or edge functions for `/calendar/feed/[token].ics`, payment webhooks, and OAuth callbacks before production subscriptions.
