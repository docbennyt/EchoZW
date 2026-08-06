# Master PDF Import Spec

Master PDF import is gated behind `VITE_ENABLE_MASTER_PDF_IMPORT=false` by default because master timetables mix programmes, cohorts, tables, page breaks, and draft-only content.

The implemented parser accepts extracted text, not raw PDF bytes. It recognizes page markers, weekday lines, time ranges, cohort codes such as `CS.1`, course codes, venue text, break rows, and lunch rows. It creates low-confidence assisted candidates with page and row traceability.

Human review is mandatory for master PDF candidates. Slashed course codes, source filenames containing `First Draft`, inconsistent lab venues, unknown cohorts, and missing semester dates all produce warnings.
