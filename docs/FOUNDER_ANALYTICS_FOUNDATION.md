# Founder Analytics Foundation

This tranche establishes CalenderZW's first-party founder analytics foundation.
It does not apply migrations, change timetable truth, change Google scopes, or
add third-party analytics.

## Identity Model

An `analytics_person` is a pseudonymous analytical record, not automatically a
known human student.

Allowed deterministic joins:

- Same persistent `anonymous_id`.
- A browser/session creates a `calendar_subscriptions.id`.
- A subscription later gains a consented `subscriber_profile_id`.
- Google Calendar connection state is linked through the same subscription via
  `google_calendar_credentials.subscription_id`.

Explicitly disallowed joins:

- IP address.
- Browser, OS, or device family.
- Timetable, class, programme, or institution similarity.
- Phone similarity.
- Event timing coincidence.

Founder-facing labels preserve confidence:

- `anonymous` -> Anonymous visitor.
- `subscription_linked` -> Subscription-linked student.
- `consented_contact_linked` -> Consented contact.

## Stitching Execution

`analytics_events` is a high-write fact table, so this tranche avoids a database
trigger on event insert. The server ingestion path calls the service-role-only
`resolve_analytics_person` function before inserting each event batch row.

If identity resolution fails, the server logs a safe operational warning and
still persists the raw analytics event with `analytics_person_id = null`.
Analytics identity enrichment must not block a student timetable view, calendar
subscription, or Google connection flow.

The resolver only uses indexed identity rows plus direct primary-key
relationships:

- `analytics_person_identities(identity_type, identity_uuid)`.
- `calendar_subscriptions(id)`.
- `google_calendar_credentials(subscription_id)`.

## SQL/API Shape

The first overview endpoint uses `get_admin_analytics_overview` as a compact
foundation for KPIs, provider mix, funnel, and data quality. Future tranches
should avoid turning that function into a monolith by moving reusable facts into
canonical views and keeping person detail, retention, programme/device, and
reliability queries as separate server-side endpoints.

React must not fetch the raw analytics event table and aggregate in the browser.
All founder analytics endpoints remain protected by server-side superadmin
authorization.
