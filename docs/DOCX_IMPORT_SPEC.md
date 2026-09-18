# Static class timetable DOCX import

DR-120 adds a class-specific static-document ingestion lane beside the live Source Gateway watcher. The source strategy is explicit: `manual`, `live_managed_source`, `static_document`, or `hybrid`. A timetable marked `static_document` is skipped by live-source draft materialization so a broad master source cannot silently supersede a class-specific authoritative document.

## Safety contract

The workflow is **Upload → deterministic extraction → human review → create draft**. There is intentionally no publish endpoint in this lane. The importer never updates `current_published_version_id`; student-visible publication still goes through the existing guarded version/publication process. Re-importing the same source document and parser version is duplicate-aware and returns the same review evidence instead of creating duplicate draft/session state.

The uploaded DOCX is persisted in the private `timetable-sources` bucket and registered in `source_documents` with original filename, MIME type, byte size, SHA-256, uploader, timestamp, parser version, institution and durable storage path. Import candidates retain table, row, column, raw text and candidate keys. Normalization never replaces the raw evidence.

The parser reads `word/document.xml` directly from the DOCX ZIP container. It uses Word table/paragraph structure and does not use OCR. Unknown or malformed schedule cells become blocking review evidence rather than disappearing. `LUNCH` is preserved as an ignored structural row, never a class session.

Canonical programme, cohort and academic-period mapping is exact-only. Ambiguous mapping requires the reviewer to select an existing entity. The import lane does not fuzzy-create academic entities.

## HIT Biotechnology canary

The acceptance fixture is `2026 SEMESTER 1 PART 1 Blended Timetable.docx`, Department of Biotechnology, 2026, Part 1, Semester 1. Conservation checks are:

- **14 timetable sessions** from the timetable grid.
- **28 timetable contact hours**.
- **6 course-reference rows**.
- Course-reference hours also total 28.
- `1215-1315 LUNCH` is ignored as a non-session break.
- Raw blended-delivery strings such as `S103 / Online Teaching` and `Auto-Hall / Online Teaching` remain visible for human verification.

The source contains `ICS 1110` in timetable cells while the course-reference section contains `SBT 1104 — Computer Applications`. CalenderZW must **never silently** substitute, merge, or reinterpret those codes. `ICS 1110` produces a blocking `COURSE_NOT_IN_REFERENCE` warning and unused `SBT 1104` produces a blocking `REFERENCE_COURSE_UNUSED` warning. A reviewer must document the verified resolution before a draft can be materialized.

## Review and draft semantics

The review UI at `/admin/static-import` is available only through the existing operational-admin authorization boundary. It displays extracted identity metadata, source SHA-256, counts, exact canonical mappings, every parser warning, source provenance coordinates and editable normalized session fields. Blocking warnings require a non-empty resolution note.

Draft materialization validates the selected programme/cohort/period relationship, academic-period dates, session candidate provenance, times, duplicate candidate keys, duplicate logical sessions and overlapping sessions. It creates a new `timetable_versions` row with `status='draft'`, `verification_status='unverified'`, `source='static_document'`, `source_document_id` and `import_batch_id`; then inserts tentative sessions with source candidate provenance. If an unrelated already-published timetable exists for the same mapping, the static importer stops and requires an explicit reconciliation path rather than overwriting it.

## Extension point

PDF or AI-assisted extraction can be added later as additional candidate generators, but they must produce the same immutable evidence, provenance, warnings and human-review contract. They may not bypass deterministic validation or guarded publication.
