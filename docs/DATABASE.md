# Database

Production persistence should use Supabase PostgreSQL with RLS.

Core tables:

- institutions
- campuses
- faculties
- programmes
- cohorts
- academic_periods
- timetables
- timetable_versions
- calendar_events
- correction_reports
- feed_tokens
- audit_logs
- payment_attempts
- entitlements

RLS principles:

- Public can read published public timetables.
- Representatives can create drafts for assigned programmes.
- Verifiers can approve, reject, publish, and rollback assigned timetables.
- Institution admins can manage their institution only.
- Platform admins operate through audited support workflows.
