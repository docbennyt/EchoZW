# Timetable Import Architecture

CalenderZW now has a normalized timetable import foundation in `supabase/migrations/0002_timetable_import_pipeline.sql` and parser/review helpers in `src/domain/timetableImport.ts`.

Protected source relay ingestion is extended by `supabase/migrations/0005_source_snapshot_ingestion.sql`, which adds a durable configured source record plus immutable source snapshots for the Live Schedule Sync relay boundary.

## Flow

1. Upload a source document to the private `timetable-sources` bucket.
2. For protected relays, accept a signed `POST /api/internal/source-snapshots` request and persist one immutable `timetable_source_snapshots` row per unique `(source_id, content_hash)`.
3. Create a `source_documents` row with filename, MIME type, size, checksum, parser version, and document type when a parser converts a durable source snapshot into a stored import artifact.
4. Create an `import_batches` row for CSV, DOCX, assisted master PDF, course catalog extraction, or later protected-source parsing.
5. Store extracted rows as `import_candidates` plus `import_candidate_warnings`.
6. Review warnings, resolve blocking issues, and approve cohort-specific candidates.
7. Create or update a draft `timetable_versions` record and normalized `timetable_sessions`.
8. Publish only after verification creates an auditable `verification_records` entry.

The existing `calendar_events` table remains supported and now links back to `timetable_sessions` and `import_candidates` for source traceability.

## Status Model

Sources move from uploaded to parsed, review required, approved, rejected, or archived. Import batches move from queued through extraction and normalization into review, ready to confirm, confirmed, failed, or cancelled.

Protected relay snapshots are immutable and enter `pending_parse` when accepted. Re-delivery of the same canonical content hash is treated as unchanged rather than as a new snapshot.

Timetable versions carry both publication status and verification status, so a community-verified timetable cannot be confused with an official one.
