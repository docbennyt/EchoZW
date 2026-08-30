# Calendar Personalisation

CalenderZW creates a calendar subscription/delivery record for each student calendar action so reminder preferences and private feed identity remain separate from the public class URL.

## Current delivery paths

- Personalised private HTTPS subscription feed for supported subscribed-calendar clients.
- Apple Calendar convenience deep link derived from the canonical HTTPS feed when the production origin is externally fetchable.
- One-time `.ics` download using the selected reminder preset.
- Google Calendar direct OAuth/API sync is **not yet enabled as a public production path** and must remain labelled future/coming soon until separately verified.

## Reminder model

Reminder offsets are stored as positive minutes before each event. Presets currently resolve to:

- On time: `30`
- Prepared: `1440, 30`
- Commuter: `60, 15`
- Custom: validated positive offsets, maximum five values

Reminders are serialized as `VALARM` entries. They never change the canonical lecture `DTSTART` or `DTEND`.

## Subscription privacy

Private subscription tokens are:

- generated from cryptographically random bytes;
- URL-safe encoded;
- stored/looked up by SHA-256 hash rather than raw token where the persistence model supports it;
- excluded from public class links and analytics payloads;
- suitable for revocation/rotation through the subscription persistence layer.

The canonical private feed URL is:

`https://calender.aido.co.zw/calendar/feed/<private-token>.ics`

The public share URL is:

`https://calender.aido.co.zw/t/<public-slug>`

Never substitute the private feed URL for the public share URL.

## Persistence and production routing

The production Node server routes dynamic calendar subscription/download/feed requests before static SPA fallback. Calendar clients fetch the feed without needing browser cookies, JavaScript, or an Authorization header.

The feed resolves the timetable's current published version at request time. A later publication can therefore update the same private subscription without issuing a new token, provided logical event identity is preserved.

## One-time import semantics

A downloaded `.ics` file is a snapshot. Once imported, that file cannot receive later CalenderZW timetable changes. Product copy must distinguish one-time import from subscription.

## Timezone semantics

The institution IANA timezone is authoritative for lecture wall-clock time. For HIT, `08:00 Africa/Harare` corresponds to `06:00Z`; a calendar client configured for GMT+00 may display 06:00 while a Harare-configured client displays 08:00. Do not compensate by manually shifting stored or serialized lecture times.

See `docs/CALENDAR_SYNC.md` and `docs/APPLE_CALENDAR_SETUP.md` for feed HTTP, Apple, TLS, and production verification details.
