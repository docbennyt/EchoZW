# EchoZW Calendar

EchoZW Calendar is an EchoZW family app by [aiDo](https://aido.co.zw). It helps students open a verified timetable from a QR code or shared link, preview lectures on a small phone, choose useful reminders, and add the timetable to their calendar without creating an account.

## Stack

- React and Vite
- TypeScript strict mode
- Zod validation
- Vitest and Testing Library
- CSS design tokens
- Supabase database/auth
- Node production API

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5173/find` to see the published timetable entry point. Until a real timetable repository is implemented, fixture-backed timetable links render an unavailable state instead of demo classes.

Google and Apple Calendar subscriptions need a public HTTPS app URL. Use the local `.ics` download for direct testing, or set `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL` to the live deployment URL for provider subscription testing.

## Environment Variables

Copy `.env.example` to `.env.local` for local work. The template is grouped by deployment boundary so server secrets are not accidentally exposed in the Vite bundle.

Production responsibilities are split between:

- Vercel: browser-safe `VITE_*` values and the public frontend.
- Railway: `PUBLIC_APP_URL`, Supabase server credentials, legal production values, OAuth secrets and optional backend integrations.

See [`docs/DEPLOYMENT_VERCEL_RAILWAY.md`](docs/DEPLOYMENT_VERCEL_RAILWAY.md) for the authoritative production variable names and topology.

## Commands

```bash
npm run build
npm start
npm run test
npm run lint
npm run format:check
npm run deploy:check -- --origin https://calender.aido.co.zw
```

`npm start` is the canonical production server command and starts the compiled Node server from `dist-server/server/productionServer.js` after `npm run build`.

## Known Limitations

- A production subscribed feed needs the server API to read published timetable rows from Supabase.
- Provider integrations remain unavailable unless their required production credentials and feature flags are configured.
- Fictional seed data remains for local development and tests only.

## Production Deployment

CalenderZW now uses a split production topology:

```text
GitHub -> Vercel frontend (calender.aido.co.zw)
             |
             +-- same-origin /api/*, /runtime-config.js and /sitemap.xml
             |   rewrites
             v
         Railway backend (api.calender.aido.co.zw)
             |
             v
          Supabase
```

Cloudflare manages DNS. Resend is configured externally as Supabase Auth SMTP.

The repository `Dockerfile` is the Railway container contract. It builds the application and starts it through `npm start`; Railway supplies `PORT`, which the Node server already reads. Do not replace the production start command with `npm run dev` or Vite preview.

`vercel.json` is the Vercel routing contract. Backend rewrites precede the SPA fallback, and server-owned timetable/SEO HTML routes continue through Railway so route-specific metadata is not lost during the hosting split.

Production legal validation and Supabase authorization validation remain fail-fast. Missing values are deployment configuration errors, not reasons to weaken the checks.

For exact Vercel, Railway, Cloudflare, Supabase, OAuth, smoke-test and rollback instructions, read [`docs/DEPLOYMENT_VERCEL_RAILWAY.md`](docs/DEPLOYMENT_VERCEL_RAILWAY.md).
