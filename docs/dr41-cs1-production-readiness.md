# DR-41 CS.1 production canary readiness

Do not mutate the official HIT document merely to prove the pipeline. Use an owned canary input and keep publication manual.

## Required schema before publication

The production database must expose the source snapshot/parse chain plus `timetable_source_reconciliations`, `timetable_source_publications`, and `publish_guarded_source_reconciliation` before `source:publish` is allowed. A missing object is a deployment blocker, never a reason to bypass guarded publication.

## CS.1 proof

The canary is the room-only change `ICS1102: N109 -> N205`. Expected chain: snapshot accepted -> parse persisted -> CS.1 reconciliation reports one unambiguous venue change -> guarded plan has no blockers -> manual publication creates one new published version -> public timetable and existing calendar feed show N205 while stable logical session identity stays unchanged.

Re-running the exact publication must be an idempotent replay. Ambiguous, invalid, overlapping, stale-base, or excessive-removal plans must stop before any student-visible pointer changes.

## Production safety

Run `npm run deploy:check` against production and the CS.1 public slug before and after the canary. Do not proceed when readiness, the public timetable canary, or the admin-session boundary is unhealthy.
