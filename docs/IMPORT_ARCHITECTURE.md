# Timetable Import Architecture

CalenderZW now has a normalized timetable import foundation in `supabase/migrations/0002_timetable_import_pipeline.sql` and parser/review helpers in `src/domain/timetableImport.ts`.

## Flow

1. Upload a source document to the private `timetable-sources` bucket.
2. Create a `source_documents` row with filename, MIME type, size, checksum, parser version, and document type.
3. Create an `import_batches` row for CSV, DOCX, assisted master PDF, or course catalog extraction.
4. Store extracted rows as `import_candidates` plus `import_candidate_warnings`.
5. Review warnings, resolve blocking issues, and approve cohort-specific candidates.
6. Create or update a draft `timetable_versions` record and normalized `timetable_sessions`.
7. Publish only after verification creates an auditable `verification_records` entry.

The existing `calendar_events` table remains supported and now links back to `timetable_sessions` and `import_candidates` for source traceability.

## Status Model

Sources move from uploaded to parsed, review required, approved, rejected, or archived. Import batches move from queued through extraction and normalization into review, ready to confirm, confirmed, failed, or cancelled.

Timetable versions carry both publication status and verification status, so a community-verified timetable cannot be confused with an official one.
