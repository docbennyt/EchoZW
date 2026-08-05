# Calendar Personalisation

Echo Calender now creates a calendar subscription record for every Quick Add session.

Working MVP paths:

- Personalised `.ics` download uses the selected reminder preset.
- Personalised feed URL is generated per subscription.
- Apple `webcal://` is generated only when the public origin is HTTPS and externally fetchable.
- Google sync is modelled behind a provider adapter and feature flag.

Reminder offsets are stored as positive minutes before each event. Supported values are 5, 10, 15, 30, 45, 60, 120, 720, and 1440 minutes. Custom reminders are limited to five offsets.

Tokens:

- generated from 32 random bytes;
- URL-safe base64 encoded;
- hashed with SHA-256 for lookup;
- not logged by analytics;
- suitable for revocation and rotation once persisted in Supabase.

Local development uses in-memory subscriptions through the Vite middleware. Production must persist `calendar_subscriptions` and `calendar_event_sync_records`.
