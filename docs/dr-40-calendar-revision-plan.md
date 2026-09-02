# DR-40 — Existing subscription propagation failure

Production evidence on 2026-09-02 showed a Class Rep correction immediately changing the public CS.1 timetable while an existing Apple subscription did not refresh.

Root causes to address in code:

1. Subscribed-calendar clients poll on their own schedule; network connectivity does not mean an immediate fetch.
2. More importantly, the private feed currently uses the base timetable version's `publishedAt` as HTTP `Last-Modified`, and the calendar projection uses that same base publication timestamp plus `versionNumber` for VEVENT `LAST-MODIFIED` and `SEQUENCE`.
3. Class Rep correction directives and date exceptions are resolved on top of that old published version, so effective calendar content can change while HTTP/ICS revision metadata remains stale.
4. A client revalidating with only `If-Modified-Since` can therefore receive an incorrect 304 after a correction. Clients may also see unchanged VEVENT `SEQUENCE`/`LAST-MODIFIED` for a changed event.

Required fix: introduce/derive a monotonic resolved timetable/calendar revision and updated timestamp covering base publication, recurring corrections, revocations/supersessions and date exceptions. Use it for HTTP `Last-Modified`, ICS `DTSTAMP`/`LAST-MODIFIED`, and VEVENT `SEQUENCE`, while keeping stable UID identity and content-hash ETag. Existing private feed URLs must continue working without resubscription.

Regression requirements:

- old ETag after correction => 200 + changed content + changed ETag;
- old If-Modified-Since after correction => 200;
- new ETag => 304;
- same logical session keeps UID;
- correction raises SEQUENCE and LAST-MODIFIED;
- pinned/source-replaceable recurring changes and one-off extra/cancel/move all propagate;
- Africa/Harare remains wall-clock truth;
- no raw private feed token in tests/logs/evidence.
