# CalenderZW production deployment: Vercel + Railway

This document is the production topology contract for CalenderZW.

## Architecture

```text
Browser
  |
  v
https://calender.aido.co.zw
  |
  v
Vercel (Vite frontend / public origin)
  |\
  | +-- static assets and SPA shell
  |
  +---- /api/* --------------------+
  +---- /runtime-config.js --------+--> https://api.calender.aido.co.zw
  +---- /sitemap.xml --------------+         |
  +---- SEO-owned HTML routes -----+         v
                                           Railway Node backend
                                             |
                                             +--> Supabase database/auth
                                             +--> Google OAuth
                                             +--> optional PesePay / workers
```

GitHub is the source of truth. Production changes are reviewed from the
`Calender` branch. Cloudflare manages DNS. Supabase provides database/auth.
Resend is configured outside this repository as Supabase Auth SMTP.

## Why browser API calls remain same-origin

The browser continues requesting `/api/...` from `calender.aido.co.zw`.
`vercel.json` rewrites those requests to the Railway custom domain. This keeps
normal browser traffic same-origin, preserves the existing API paths and OAuth
callback, and avoids widening CORS for authenticated admin endpoints.

The same rule applies to `/runtime-config.js` and `/sitemap.xml`.

## Vercel

### Source

- Repository: `docbennyt/EchoZW`
- Production branch: `Calender`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

`vercel.json` is the routing source of truth. API/runtime/sitemap rewrites must
remain before the SPA catch-all.

### Server-owned SEO HTML

The Node server currently injects route-specific metadata for public timetable
pages and selected SPA routes. To avoid an SEO regression during the hosting
split, Vercel proxies those HTML requests to Railway while Vercel continues to
serve the compiled JS/CSS/static assets. In particular, `/t/:slug` must keep
its server-resolved canonical metadata.

Do not replace the `/t/:path*` rewrite with the generic Vite catch-all unless
that metadata behavior has first been moved to a Vercel-compatible server
implementation with equivalent tests.

### Vercel environment variables

Only browser-safe variables belong in Vercel. Typical production names are:

```text
VITE_PUBLIC_APP_URL
VITE_APP_BASE_URL
VITE_SUPPORT_EMAIL
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_ENABLE_GOOGLE_CALENDAR_SYNC
VITE_ENABLE_PESEPAY_CHECKOUT
VITE_ENABLE_PREMIUM_FEATURES
VITE_ENABLE_PRIVATE_TIMETABLES
VITE_ENABLE_DOCUMENT_UPLOADS
VITE_ENABLE_CSV_IMPORT
VITE_ENABLE_DOCX_IMPORT
VITE_ENABLE_MASTER_PDF_IMPORT
VITE_ENABLE_AI_EXTRACTION
VITE_ENABLE_INSTITUTION_BRANDING
VITE_ENABLE_WEB_PUSH
VITE_ENABLE_WHATSAPP_NOTIFICATIONS
```

Never put server credentials such as `SUPABASE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
`CALENDAR_TOKEN_HASH_SECRET`, PesePay encryption/webhook secrets, or VAPID
private keys into a `VITE_*` variable.

## Railway

### Source and runtime

Configure one persistent web service with:

- Repository: `docbennyt/EchoZW`
- Branch: `Calender`
- Root directory: repository root
- Build: use the repository `Dockerfile`
- Custom build command: blank
- Custom start command: blank when using the Dockerfile
- Docker command: `npm start`
- Healthcheck path: `/api/health/ready` for production promotion
- Temporary diagnostic healthcheck: `/api/health/live`
- Port: do not set a fixed value; Railway injects `PORT`
- Public custom domain: `api.calender.aido.co.zw`

The Node server listens on `0.0.0.0` and reads `process.env.PORT`.

Railway's legacy `railway.toml` / `railway.json` Config-as-Code mechanism is
deprecated for new services. Do not add a new legacy file to this repository.
If the project is later migrated to Railway Infrastructure as Code, generate
`.railway/railway.ts` from the authenticated Railway project (`railway config
init` / `railway config pull`) so project/service IDs and settings are real,
not guessed.

### Required Railway variables

Set these in Railway, not in source control:

```text
NODE_ENV
PUBLIC_APP_URL
SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
LEGAL_OPERATOR_NAME
LEGAL_TRADING_NAME
LEGAL_OPERATOR_ADDRESS
LEGAL_COUNTRY
LEGAL_SUPPORT_EMAIL
LEGAL_PRIVACY_EMAIL
LEGAL_EFFECTIVE_DATE
LEGAL_LAST_UPDATED_DATE
LEGAL_MINIMUM_AGE
LEGAL_GOVERNING_LAW
LEGAL_DISPUTE_VENUE
```

Production values with fixed public meaning:

```text
NODE_ENV=production
PUBLIC_APP_URL=https://calender.aido.co.zw
LEGAL_TRADING_NAME=CalenderZW
LEGAL_COUNTRY=Zimbabwe
LEGAL_SUPPORT_EMAIL=support@aido.co.zw
LEGAL_PRIVACY_EMAIL=privacy@aido.co.zw
LEGAL_MINIMUM_AGE=13
```

Human-reviewed values are required for operator name/address, governing law,
dispute venue, and legal update dates. Do not invent them to make a deployment
pass.

If Google Calendar direct sync is enabled, Railway also needs:

```text
ENABLE_GOOGLE_CALENDAR_SYNC
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
```

with:

```text
GOOGLE_REDIRECT_URI=https://calender.aido.co.zw/api/calendar/google/callback
```

Server-only calendar and optional integrations may additionally require:

```text
CALENDAR_TOKEN_HASH_SECRET
TOKEN_ENCRYPTION_KEY
HIT_TIMETABLE_RELAY_SECRET
PESEPAY_INTEGRATION_KEY
PESEPAY_ENCRYPTION_KEY
PESEPAY_WEBHOOK_SECRET
PESEPAY_RETURN_URL
PESEPAY_RESULT_URL
WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
WEB_PUSH_VAPID_SUBJECT
```

### Startup validation

Production startup intentionally fails before listening when required legal or
Supabase configuration is missing. The server writes a structured
`app.startup_config_error` event with the validation message and never logs the
secret values themselves.

Do not bypass this gate. Fix the Railway variables.

### Health endpoints

- `GET /api/health/live` — process liveness only.
- `GET /api/health/ready` — server config, Supabase connectivity, schema
  compatibility and browser auth/runtime config.

Railway should use readiness for final deployment promotion. If a new service
cannot start while configuration is being diagnosed, use liveness temporarily,
then restore readiness before production traffic.

## Cloudflare DNS

The intended DNS shape is:

```text
calender.aido.co.zw      -> Vercel
api.calender.aido.co.zw  -> Railway
```

Use the exact CNAME/verification values shown by Vercel and Railway. Do not
commit generated provider hostnames or guess an IP address. Railway custom HTTP
domains use its generated DNS target; a Railway static outbound IP is not an
inbound DNS address.

Keep the Railway nested custom domain DNS-only while verifying TLS unless your
Cloudflare plan/certificate setup explicitly supports proxying that hostname.

## Supabase

Railway talks to Supabase over the Supabase HTTPS APIs using `SUPABASE_URL`, the
public publishable key where required, and `SUPABASE_SECRET_KEY` for privileged
server operations. The privileged key is backend-only.

Supabase Auth SMTP/Resend is configured outside this repository. The frontend
account recovery and invite routes remain on `calender.aido.co.zw`.

## Google OAuth

The provider callback remains:

```text
https://calender.aido.co.zw/api/calendar/google/callback
```

Vercel proxies it to Railway, so the provider-facing origin does not change.
Do not change the OAuth callback host to the Railway domain merely because the
backend moved.

## Runtime public config

`index.html` loads `/runtime-config.js` before the React module. Vercel proxies
that request to Railway. The response contains only the Supabase URL,
publishable key, public app URL and optional release SHA, and is served with
`Cache-Control: no-store`.

## Production smoke

After Vercel, Railway and Cloudflare are configured, run the smoke test against
the public user origin rather than only the backend:

```bash
npm run deploy:check -- --origin https://calender.aido.co.zw
```

This validates the real request chain through Vercel to Railway and Supabase:

1. `/api/health/ready`
2. a published timetable canary
3. the admin-session boundary

A direct Railway liveness/readiness request is useful for diagnosis, but does
not replace the public-origin smoke test.

## Rollback

Frontend-only regression:

- restore/redeploy the prior known-good Vercel deployment.

Backend-only regression:

- restore/redeploy the prior known-good Railway deployment.

Do not roll back or mutate Supabase schema merely to roll back a frontend
release. Database migrations need their own compatibility/rollback decision.

## Deployment completion gate

A build is not proof of production success. Do not declare this migration done
until all of the following are true:

- Railway `/api/health/live` returns 200.
- Railway `/api/health/ready` returns 200.
- Vercel serves the public frontend.
- `calender.aido.co.zw/api/...` reaches Railway through the rewrite.
- `/runtime-config.js` and `/sitemap.xml` work on the public origin.
- a real `/t/:slug` retains correct canonical/OG metadata.
- Google OAuth/account recovery paths remain correct.
- `npm run deploy:check -- --origin https://calender.aido.co.zw` passes.
