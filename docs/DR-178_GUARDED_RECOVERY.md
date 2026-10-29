# DR-178 guarded recovery and exam foundation

## Scope

This candidate preserves the published HIT lecture pause through 30 November
2026 inclusive. Explicit Exam, Examination and Assessment session types bypass
lecture pauses; course names never infer category. Exams must be dated extra
exceptions, not weekly recurring sessions. Other categories retain existing
lecture-pause behavior. No examination records are fabricated.

Exam exceptions use the immutable supersession root in an `exam:` identity
namespace. Public readers include inactive ancestry only for identity resolution;
only active exceptions appear in the published schedule. History is paged by ID
in batches of 500, bounded at 10,000 rows and fails closed at that limit. Missing
or cyclic ancestry also fails closed. This does not prove the unavailable import
workflow preserves examination records; that remains a release prerequisite.

## Reminder migration

`20261028212057_independent_exam_reminders.sql` adds independently configured
subscription exam reminders, default empty, maximum five positive minute offsets
up to 28 days. Existing lecture reminders and subscription identities remain.
An actual reminder-policy edit atomically calls the existing Google enqueue RPC;
no-op edits do not. Leases, retry delays and reconnect fences remain authoritative.
Public ICS and Google consume the same effective projection and exam policy.
There is no new student reminder-settings interface in this candidate. Configure
only through an authorized subscription operation; existing accounts default to
no exam alarms until explicitly configured.

Apply only after independent migration review. Do not reset or reseed data.
Rollback application code to the previous reviewed Worker version through the
protected staging deployment mechanism, and remove temporary recovery authority.
The additive column can remain during rollback; remove the exam reminder trigger
only through a separately reviewed migration if application rollback requires it.
Do not drop subscription records or calendar mappings.

## Real-account recovery fence

The private `GOOGLE_RECOVERY_CANARY` retains its owner, subscription, timetable,
release SHA, expiry and deliver mode. It now additionally requires `revision`,
`connectionGeneration`, `maxCreates: 0` and `maxDeletes: 0`. Old scopes fail closed.
The initial published snapshot and each provider mutation recheck the pinned
revision and existing generation fence. Existing calendars and verified managed
events are mandatory; POST and DELETE are rejected by the shared provider write
wrapper for this recovery scope. QA and separately approved global delivery
continue using the existing machinery.

Read-only preview includes actual Google event fields and compares summary,
description, location, start/end/timezone, recurrence and reminders. Local mapping
hashes alone cannot establish `remoteContentsVerified`. Incomplete provider reads
never emit an executable recovery guard. The operations workflow must match the
preview guard to the private plan before authorizing one connection.

Provider accepted-update telemetry includes only operation, source SHA and
revision. Job completion, accepted provider operations and actual remote content
must all be independently verified before reporting convergence. A successful
mock/test/queue acknowledgement is not live provider evidence.

## Release prerequisites and rollback

Keep global Google delivery disabled. Deploy only the independently reviewed
exact candidate using the existing Cloudflare Reviewed Staging workflow, then
recreate the private recovery plan against that exact SHA and current database
revision/generation. Run preview before any canary. Remove temporary authority in
finally and verify the resulting active Worker version and public source SHA.
If a run is interrupted, use protected operations `disable` and verify absence.

The production hostname still needs DR-166 cutover approval and actual acceptance.
No staging result authorizes a direct production DNS or secret change. Do not
close DR-178 on source tests, staging acceptance, or pending outbox rows.
