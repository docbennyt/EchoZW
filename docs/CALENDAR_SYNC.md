# Calendar Sync

## Current architecture

CalenderZW calendar delivery is downstream of the current published timetable version:

```text
configured source
  → snapshot
  → deterministic parse
  → reconciliation
  → guarded publication
  → current published timetable version
  → canonical calendar projection
  → private subscription feed / one-time .ics
  → Apple Calendar now; Google/Outlook adapters later
```

The public `/t/:slug` page and calendar feed must both resolve the same `current_published_version_id`. Raw source candidates, drafts, or unresolved reconciliation output must never appear in a student's calendar before safe publication.

## Working paths

- Public `/t/:slug` timetable backed by the current published version.
- Per-subscription private HTTPS feed at `/calendar/feed/<token>.ics`.
- One-time `.ics` download for the current publication.
- Reminder presets and validated custom reminder offsets.
- Stable ICS event UIDs based on logical `stable_session_key` for published timetable sessions.
- `SEQUENCE` based on the published timetable version.
- `LAST-MODIFIED` based on publication time.
- Weekly recurrence bounded by the academic period.
- IANA institution timezone handling and `VTIMEZONE` serialization.
- GET/HEAD calendar-feed responses with conditional ETag/304 revalidation.
- Feed privacy headers and safe 404 handling for invalid/revoked tokens.

## Canonical event model

Provider-specific delivery must consume the same canonical published-calendar projection. The projection owns:

- logical stable session identity;
- course/session metadata;
- institution IANA timezone;
- local start and end wall-clock time;
- equivalent UTC instants;
- recurrence boundary;
- publication sequence and last-modified timestamp;
- reminder alarms.

Apple/ICS and future Google/Outlook adapters must not duplicate business date arithmetic or invent provider-specific logical identities.

## Timezone rule

Institution-local timetable time is authoritative.

For example:

- `08:00 Africa/Harare` is an 08:00 HIT lecture;
- the same instant is `06:00Z`;
- a client configured to display GMT+00 may therefore show 06:00;
- a client displaying Africa/Harare should show 08:00.

Do not compensate for client display timezone with manual offset arithmetic. Reminder alarms are separate `VALARM` entries and never modify `DTSTART`/`DTEND`.

## Subscription vs one-time import

### Private subscription feed

`https://calender.aido.co.zw/calendar/feed/<private-token>.ics`

- bearer-style private URL;
- no login/cookie/JavaScript required for calendar-client fetches;
- resolves the current published timetable on each revalidated request;
- keeps the same subscription token across future publications;
- preserves UID when the logical session identity is preserved;
- uses a higher `SEQUENCE` after a newer publication;
- may be refreshed on a schedule controlled by the calendar client.

### One-time .ics

The download route is a snapshot of the current publication. Importing the file does not create a remotely refreshed subscription. Product copy must not call the downloaded file “sync”.

## Production feed HTTP contract

For a valid active token:

- GET → `200` with `Content-Type: text/calendar; charset=utf-8`;
- HEAD → `200` with equivalent useful metadata and no body;
- `ETag` identifies the current generated feed state;
- `If-None-Match` may return `304` when unchanged;
- `Last-Modified` reflects the current publication timestamp;
- cache policy requires revalidation rather than long-lived immutable caching;
- `X-Robots-Tag: noindex, nofollow`;
- `Referrer-Policy: no-referrer`;
- no session cookie or Authorization header is required.

Invalid/revoked tokens return a safe `404` without timetable or token detail leakage.

Production Node routing is implemented in `server/productionServer.ts`, which delegates calendar routes to `server/pilotCalendarApi.ts` before static/SPA fallback. The older statement that production still needs a dynamic feed route is no longer accurate.

## Apple

The canonical Apple subscription identity is the private HTTPS feed URL. An optional `webcal://` value may be returned as a convenience deep link only after deriving it from the secure HTTPS URL.

See `docs/APPLE_CALENDAR_SETUP.md` for the real-device flow and the `Validation failed` / `Insecure Connection` diagnostic decision tree.

## Google Calendar

Direct Google Calendar OAuth/API synchronization is not part of the Apple/calendar-feed reliability boundary. Do not present direct Google sync as active on the public timetable until the production integration is separately implemented and verified.

A Google Calendar screen displaying GMT+00 may show a Zimbabwe 08:00 lecture at 06:00 because those represent the same instant. That is not evidence that reminders changed the event time.

## Production transport diagnostic

After deployment and creation of a fresh private test subscription, run:

```bash
npm run calendar:diagnose -- "https://calender.aido.co.zw/calendar/feed/<private-token>.ics"
```

The diagnostic must redact the private token and checks DNS, TLS/certificate metadata, redirect safety, HEAD/GET behavior, content type, VCALENDAR content, ETag/304, privacy headers, and safe invalid-token behavior.

A successful repository test suite is not proof that an iPhone trusts the production TLS chain. Real-device Apple verification remains a release gate.

## Source-to-calendar boundary

A feed can follow **new published versions** without a new subscription. That does not by itself mean official-source changes are automatically safe to publish. The guarded source reconciliation/publication path remains a separate reliability boundary.
