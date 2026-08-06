# Source Traceability

Every imported timetable artifact should be traceable back to its source:

- `source_documents` records checksum, storage path, filename, document type, parser version, and metadata.
- `import_batches` records parser mode, selected context, operator, status, and summary.
- `import_candidates` records raw text, source page/table/cell/row, normalized payload, match IDs, and review status.
- `import_candidate_warnings` records warning code, severity, field, suggested value, and resolution metadata.
- `timetable_sessions` links to the candidate that produced the confirmed session.
- `calendar_events` can link to both normalized sessions and source candidates.

This makes it possible to answer which file, page, row, and reviewer produced a published calendar entry.
