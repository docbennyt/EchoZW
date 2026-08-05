# Deployment

## Static Pilot

```bash
npm ci
npm run build
```

Deploy `dist/` to Vercel, Cloudflare Pages, Netlify, or equivalent.

## Production Additions

- Supabase project, migrations, and RLS.
- Edge/server routes for calendar feeds, OAuth callbacks, and webhooks.
- Sentry and PostHog keys.
- Verified domain and HTTPS.
- Set `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL` to the same public HTTPS origin.
