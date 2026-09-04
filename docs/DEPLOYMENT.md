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
- Liveness check: `/api/health/live`.
- Readiness check: `/api/health/ready`.

## Deployment Order

Production schema migrations must be applied before any app revision that reads
new tables, columns, RLS-dependent functions, or RPCs is promoted to live
traffic. Supabase migration files are the reviewed schema source of truth; do
not use startup logs from source snapshot ingestion or Google OAuth config as
proof that public timetable or staff authorization paths are healthy.

1. Fetch the exact branch head being deployed and review its Supabase migration
   diff.
2. Apply pending Supabase migrations to the target database using the approved
   migration mechanism.
3. Verify migration history and schema readiness before promoting the app:

   ```bash
   npm run deploy:check -- --origin https://candidate-or-production-origin
   ```

4. Promote the app only when `/api/health/ready` reports `ready` and the smoke
   command passes.
5. After promotion, rerun the same smoke command against
   `https://calender.aido.co.zw`.

Use `CALENDERZW_SMOKE_TIMETABLE_SLUG` to override the default public timetable
canary. Use `CALENDERZW_SMOKE_ADMIN_BEARER_TOKEN` only in a protected deployment
environment when an authenticated staff-session check is required; the smoke
script does not print the token.

## Rollback

If a deployment reaches production before the matching migration, keep the
database intact and roll the app back to the last revision compatible with the
currently applied schema. Then apply the missing reviewed migration, confirm
`/api/health/ready`, and redeploy the intended app revision. Do not drop tables,
delete migration history, or manually mark migrations as applied unless a
human-reviewed Supabase repair plan explicitly says to do so.
