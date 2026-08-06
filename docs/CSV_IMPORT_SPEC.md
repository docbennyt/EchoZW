# CSV Import Spec

CSV import is the safest bulk path and is enabled by default with `VITE_ENABLE_CSV_IMPORT=true`.

## Required Columns

- `programme_code`
- `cohort_code`
- `course_code`
- `day`
- `start_time`
- `end_time`
- `venue`

## Optional Columns

- `lecturer`
- `start_date`
- `end_date`
- `session_type`
- `group`
- `notes`

Rows are converted into `ImportCandidate` objects. Notes beginning with `=`, `+`, `-`, or `@` are prefixed to reduce spreadsheet formula-injection risk when exported for review.

## Review Rules

Unknown programmes, cohorts, courses, invalid time ranges, and missing academic-period dates are blocking. Missing venues and inconsistent venue formats are warnings. Candidates are not publishable until blocking warnings are resolved.
