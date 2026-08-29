# Timetable Import Architecture

CalenderZW now has a normalized timetable import foundation in `supabase/migrations/0002_timetable_import_pipeline.sql` and parser/review helpers in `src/domain/timetableImport.ts`.

Protected source relay ingestion is extended by `supabase/migrations/0005_source_snapshot_ingestion.sql`, which adds a durable configured source record plus immutable source snapshots for the Live Schedule Sync relay boundary.

## Flow

1. Upload a source document to the private `timetable-sources` bucket.
2. For protected relays, accept a signed `POST /api/internal/source-snapshots` request and persist one immutable `timetable_source_snapshots` row per unique `(source_id, content_hash)`.
3. Parse protected HIT master snapshots with the explicit deterministic parser version `hit-sist-google-docs-v1`, detecting the master `TIME x weekday` grid and programme reference tables structurally rather than by fixed table index.
4. Persist one `timetable_source_parse_runs` record per unique `(snapshot_id, parser_version)` with the parser summary, deterministic candidate IDs, review-required warnings, and full provenance-bearing result payload.
5. Create a `source_documents` row with filename, MIME type, size, checksum, parser version, and document type when a parser converts a durable source snapshot into a stored import artifact.
6. Create an `import_batches` row for CSV, DOCX, assisted master PDF, course catalog extraction, or later protected-source reconciliation.
7. Store extracted rows as `import_candidates` plus `import_candidate_warnings`.
8. Review warnings, resolve blocking issues, and approve cohort-specific candidates.
9. Create or update a draft `timetable_versions` record and normalized `timetable_sessions`.
10. Publish only after verification creates an auditable `verification_records` entry.

The existing `calendar_events` table remains supported and now links back to `timetable_sessions` and `import_candidates` for source traceability.

## Status Model

Sources move from uploaded to parsed, review required, approved, rejected, or archived. Import batches move from queued through extraction and normalization into review, ready to confirm, confirmed, failed, or cancelled.

Protected relay snapshots are immutable and enter `pending_parse` when accepted. Re-delivery of the same canonical content hash is treated as unchanged rather than as a new snapshot.

Protected-source parse runs are also immutable at the `(snapshot_id, parser_version)` boundary. Re-running the same parser version against the same snapshot must yield the same semantic result and the same deterministic candidate IDs, otherwise the parser version contract has been violated and the run is rejected.

The deterministic HIT parser is intentionally limited to snapshot interpretation and candidate persistence. It does not create timetable versions, edit timetable sessions, generate `stable_session_key` values, or move publication pointers.

Timetable versions carry both publication status and verification status, so a community-verified timetable cannot be confused with an official one.
