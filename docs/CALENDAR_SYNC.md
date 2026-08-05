# Calendar Sync

## Working

- Browser `.ics` download.
- Per-subscription `.ics` feed in Vite dev/preview middleware.
- Apple `webcal://` generation when `PUBLIC_APP_URL` is public HTTPS.
- Reminder presets and safe custom reminder limits.
- Stable event UIDs from timetable and lecture identity.
- Weekly recurrence with semester end date.
- Exclusions for skipped dates.
- Calendar escaping and line folding.

## Production Feed Requirement

Static hosting cannot serve dynamic private subscribed feeds with correct `text/calendar` headers. The Vite MVP middleware proves the route locally, but production still needs a server or edge route for `/calendar/feed/[token].ics` that:

- validates and hashes tokens;
- applies rate limits;
- sets `Content-Type: text/calendar; charset=utf-8`;
- sets `X-Robots-Tag: noindex`;
- returns current published timetable version;
- supports token revocation and rotation.

Google Calendar should use OAuth/API sync for the primary path. Do not instruct mobile Google users to subscribe to arbitrary URLs as the main journey.
