# Isolated Google delivery acceptance

The public production domain is still outside this staging deployment. A working
staging feed does not repair the URLs existing subscribers poll in production.
On 27 October, the existing HIT ICS 1.1 download returned 404 at production and
200 at staging, where it contained 15 events, 93 exclusions and revision 204.
The saved institution SWOT pause is 26 October through 30 November, inclusive;
the operator confirmed the end date. Preserve its dates and existing identities.

## Boundary

Keep `ENABLE_GOOGLE_DELIVERY=false`. The canary uses operator-managed bindings,
never caller-supplied scope or a public feature toggle:

- `APP_ENV=cloudflare-staging`.
- `GOOGLE_CANARY_OWNER_ID`: dedicated QA anonymous owner, not a student session.
- `GOOGLE_CANARY_TIMETABLE_ID`: isolated, published QA timetable.
- `GOOGLE_CANARY_EXPIRES_AT`: an absolute ISO timestamp within the next 24 hours.
- `GOOGLE_CANARY_SUBSCRIPTION_ID`: exactly one verified QA Google subscription.

Missing, malformed, expired or production-environment scope permits no provider
work. Enrollment may prepare a pending record for the owner/timetable before
the subscription ID is selected. It does not exchange credentials, call Google
or start delivery. Inspect that pending record and select its exact ID before
following the normal OAuth connect link. Do not select an existing student
connection, replace a student subscription, or modify ownership with SQL.

Scope bindings should be kept private and provisioned through the existing
trusted deployment process. Changing bindings creates a new Worker version;
record the resulting reviewed deployment/version rather than reusing old
active-version acceptance. Do not weaken protected runtime configuration checks
or use local deployment to bypass review. This document does not approve a SHA.

Status is enabled only for that owner (existing anonymous header/cookie rules).
Enrollment is limited to its timetable. OAuth initiation, consumed callback
state, service synchronization, enqueue, claim and continuation must agree on
the selected subscription and its persisted owner/timetable. Callback state must
also retain that owner. Ordinary targeted read-only diagnostics remain distinct
from write permission.

The isolated scheduler reads only the selected subscription and its credential
presence, revision and job. It creates/advances durable intent when needed and
wakes incomplete due work. It never calls broad recovery or lists student jobs.
An already completed revision/generation stays quiet; reconnect and retry dates
remain authoritative. Queue consumers still use database leases, bounded request
budgets and fenced completion, and retry foreign or disabled messages without
claiming their work. The existing explicit global delivery policy remains for a
separately approved production release.

## Live procedure after exact-commit review

1. Deploy the reviewed candidate through protected staging. Preserve the prior
   successful run 40414702075 as historical baseline evidence.
2. Confirm the configured Google OAuth redirect is the registered staging
   callback. Check the exact staging return origin; do not change production's
   OAuth/Auth configuration or export credential values. Use normal owner consent
   and a newly CZW-managed test calendar, with no student calendars as targets.
3. Create pending setup through the ordinary subscription endpoint for the QA
   owner/timetable; select the returned ID in the private scope. Follow normal
   OAuth and record only redacted outcomes. A success redirect proves connection
   and durable enqueue, not completed provider delivery.
4. Inspect real Google content and durable job watermarks after initial delivery.
   Verify a QA lecture's add, correction update, remove and undo. For a recurring
   lecture, apply a bounded QA pause and verify its EXDATE projection remotely,
   then resume through the audited UI and verify that projection clears.
5. Repeat wakes and exercise retry/continuation in isolation. Verify eventual
   convergence, stable managed identities, lease fencing and unchanged unrelated
   events. Do not simulate failure by changing existing student credentials.
6. On expiry/disablement, verify no further provider execution. Only consider
   broad delivery after independent acceptance and the separate production gate.

Source tests and synthetic provider fixtures do not establish live Google or
Queue acceptance. Record the exact source SHA, Worker version and evidence for
each live assertion. Do not call production restored until its original host and
existing subscriber URLs actually work.
