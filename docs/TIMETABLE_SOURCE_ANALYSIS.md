# Timetable Source Analysis

## File Availability

The requested source files were not present in the repository, workspace attachments, or the searched `Documents` tree during implementation:

- `SIST_Master_Timetable_Semester1_2026(First Draft).pdf`
- `MY TIMETABLE.docx`

The conclusions below are therefore based on the supplied request text and the intended import contract, not direct byte-level inspection of those files. Direct extraction quality, exact page/table geometry, hidden text, and formatting anomalies must be rechecked once the files are available.

## Expected Source Characteristics

The master PDF is treated as an assisted extraction source only. It can contain mixed cohorts, page/table boundaries, shared time slots, break/lunch rows, slash-separated courses, inconsistent lab venue formatting, and draft markings such as `First Draft`.

The cohort DOCX is treated as a higher-confidence structured source when the operator selects the programme, cohort, and academic period before import. It is still reviewed because rows may inherit day labels, omit venues, or contain lecturer/course mismatches.

## Risk Markers

- `First Draft` source filenames create a warning and should prevent official publication until reviewed.
- Slashed course codes are ambiguous and require human confirmation.
- `N101LAB` or `N101 LAB` normalizes to `N101-LAB` but remains reviewable.
- `ISE` is flagged as a likely typo for `SE`.
- Break and lunch rows are retained as ignored candidates for traceability, not published sessions.
