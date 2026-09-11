# DR-62 public timetable settings rollout

## Purpose

DR-62 adds founder-controlled public presentation settings without changing timetable truth, publication/versioning, corrections, calendar subscription identities, stable session keys, ICS UIDs, or the web-push backend.

## Deployment order

1. Apply `0030_timetable_public_settings.sql` to production.
2. Verify the table exists, RLS is enabled, `anon` and `authenticated` have no table privileges, and every existing timetable has both flags `false`.
3. Deploy the reviewed web/server commit.
4. As founder-superadmin, open one timetable editor and verify both switches are OFF.
5. Toggle one flag on a non-critical timetable, confirm the public API exposes only the corresponding sanitized boolean, then return it OFF unless product rollout intentionally enables it.

The migration is safe to apply before the web deploy: older application versions ignore the new table. The new application is also tolerant of a temporarily missing table for public reads: it fails closed to both flags OFF so the trusted public timetable remains available. Mutations fail with a 503 compatibility error until the migration exists; they never pretend a setting was saved.

## Rollback

If application code must roll back, redeploy the previous reviewed application commit. The additive settings table may remain safely in place because old code does not read it.

If the schema itself must later be removed, first deploy code that no longer reads or writes the table, verify production is stable, then perform a separately reviewed destructive migration. Do not drop the table as part of an emergency application rollback.

## Production verification

Run read-only checks for:

- `public.timetable_public_settings` exists;
- row count equals current `public.timetables` count immediately after migration;
- `show_visual_preview = false` for every backfilled row;
- `show_change_alerts = false` for every backfilled row;
- RLS is enabled;
- no `anon` or `authenticated` table privileges exist;
- the protected founder remains exactly one active `staff_users` row with `role = 'superadmin'` and `is_founder = true`.

Then verify the public endpoint never contains `updated_by_staff_user_id`, staff IDs, or audit metadata.
