# Course Catalog Import

The schema supports course catalog extraction through `courses` and `programme_courses`, with each mapping optionally linked to a `source_documents` row.

Course catalogs should be imported before timetable publication so session candidates can be matched against known courses and programme-course relationships. Unknown courses or courses outside the selected programme are blocking warnings.

Recommended review fields are programme code, course code, course name, lecturer text, level label, academic period label, source document, and raw extracted text.
