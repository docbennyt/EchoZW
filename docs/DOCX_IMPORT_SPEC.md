# DOCX Import Spec

DOCX import is enabled by default with `VITE_ENABLE_DOCX_IMPORT=true` when the operator selects a programme, cohort, and academic period before parsing.

The current implementation accepts structured DOCX table rows after extraction by a document parser. Each row should provide day, time, course, venue, lecturer, and source row metadata. Day values may be inherited from the previous non-empty day row.

DOCX-derived candidates keep raw row text, source row numbers, normalized lecturer names, normalized venues, matched course codes, confidence, and warnings. The importer does not publish DOCX content directly.
