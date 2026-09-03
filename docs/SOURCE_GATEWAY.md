# Source Gateway

Source Gateway turns an authorised external timetable document into private
CalenderZW review drafts. It does not publish timetables.

## Model

- Source: configured row in `timetable_sources`.
- Snapshot: immutable received payload in `timetable_source_snapshots`.
- Parse run: deterministic parser output in `timetable_source_parse_runs`.
- Discovery: source programme/cohort codes observed in the latest parse.
- Mapping: human-approved source code to internal programme, cohort, and period.
- Reconciliation binding: source cohort to timetable target.
- Draft version: unpublished `timetable_versions` row with generated sessions.
- Published version: student-facing truth through `current_published_version_id`.

## Automated

1. Apps Script posts a signed snapshot to `/api/internal/source-snapshots`.
2. The request authenticates through the source row's
   `relay_secret_env_name`; secret values stay in process env only.
3. New snapshots enqueue `timetable_source_processing_jobs`.
4. The Node worker claims queued jobs with `FOR UPDATE SKIP LOCKED`.
5. The processing service resolves `parser_profile` through the parser
   registry.
6. Successful parse runs upsert discovered programmes and cohorts.
7. Mapped cohorts fan out into source-generated review drafts.

## Human

- Superadmins map source programme codes to existing programmes.
- Superadmins map source cohort codes to an existing programme, class group,
  and academic period.
- Admins review generated draft timetables.
- Publication remains the existing explicit timetable publish action.

## Safety

Source processing never calls `publish_timetable_version`, never calls Google
Calendar sync, and never writes `current_published_version_id`. Generated
sessions are written to unpublished draft versions and linked to their
`source_parse_run_id` and `source_candidate_key` for provenance.

Unknown course codes are not invented. If the source has a course expression
but no resolved catalog code, the source expression is retained for review.
Missing lecturer and venue values remain null.

## Current Parser Registry

`hit_sist_master_v1` maps to the deterministic HIT SIST Google Docs parser.
Future university parsers should register a new explicit profile rather than
branching on source keys in ingestion or CLI code.
