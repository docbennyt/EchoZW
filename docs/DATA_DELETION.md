# Data Deletion

Public instructions are available at `/data-deletion`.

Implemented MVP endpoints:

- `POST /api/account/delete-request`
- `POST /api/calendar/google/disconnect`
- `POST /api/calendar/subscriptions/:id/revoke`

Current behaviour:

- Account deletion requests return a confirmation reference for operator review.
- Google disconnect marks the subscription disconnected and discards stored provider identifiers where requested.
- Private feed revocation marks the subscription revoked and future feed requests return not found.
- Optional subscriber contact deletion unlinks or removes the phone profile used for consented timetable update contact.
- Raw private feed tokens are not persisted.
- Raw Google OAuth tokens are not currently persisted by this MVP.
- Phone contact is not stored in analytics events, public timetable responses, or feed URLs.

Records may need to be retained for security, fraud prevention, accounting, legal compliance, or timetable audit integrity.
