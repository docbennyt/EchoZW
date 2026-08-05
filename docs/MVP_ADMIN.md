# MVP Admin

Routes:

- `/admin/login`
- `/admin`
- `/admin/timetables`
- `/admin/timetables/new`
- `/admin/timetables/:id`
- `/admin/timetables/:id/edit`
- `/admin/timetables/:id/preview`

The current Vite MVP includes a visible admin surface and bootstrap email check for demos. Production must use Supabase Auth, server-side admin profiles, and RLS.

Required capabilities documented in the UI:

- create timetable;
- edit metadata;
- edit lecture entries;
- publish new version;
- duplicate;
- archive;
- preview public URL;
- download QR code;
- view subscription counts;
- inspect reports;
- revoke feed links.

Published timetables should be archived rather than hard-deleted.
