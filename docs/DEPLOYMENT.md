# Deployment

## Static Pilot

```bash
npm ci
npm run build
```

The production runtime must serve both `dist/` and the calendar API routes:

```bash
npm run build
npm run preview
```

## Production Additions

- Supabase project, migrations, and RLS.
- The Node production server in `dist-server/server/productionServer.js` for calendar feeds and OAuth callbacks.
- Sentry and PostHog keys.
- Verified domain and HTTPS.
- Set `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL` to the same public HTTPS origin. The server can fall back to proxy headers, but explicit env values are safer for calendar subscriptions.
- Set `GOOGLE_REDIRECT_URI` explicitly to `https://calender.aido.co.zw/api/calendar/google/callback`. This exact value must also be registered in Google Cloud Console. The OAuth callback URI is not derived from `PUBLIC_APP_URL`.
- Set `GOOGLE_CONFIG_STATUS_ADMIN_KEY` to allow production admins to call `/api/calendar/google/config-status` without exposing the Google client secret.
- Set `VITE_ALLOWED_HOSTS` only when adding extra preview/dev hosts beyond `calender.aido.co.zw` and `calendar.aido.co.zw`.
- For Docker/EasyPanel, mount persistent storage at `/data` or set `CALENDAR_STORE_PATH` to a writable persistent file.
- Health check: `/healthz`.
