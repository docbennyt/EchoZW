# Import Review Workflow

Admin review should show candidates grouped by cohort with counts for valid, warning, invalid, and ignored rows.

Reviewers resolve blocking warnings first, then confirm warning-level candidates. Ignored rows such as break and lunch remain in the audit trail but are not emitted to calendars.

Draft creation requires at least one approved candidate and no blocking warnings among approved candidates. Official publication requires a verification record and should never be created directly from a `First Draft` source without explicit review notes.
