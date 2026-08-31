# CalenderZW first-party analytics privacy contract

CalenderZW uses first-party anonymous product analytics to understand whether students can find a timetable, add it to a calendar, and continue receiving a healthy private calendar feed. The analytics path is operational telemetry, not an identity system.

## Identity

The browser creates a random `anonymous_id` in local storage and a random `session_id` in session storage. Both are UUIDs. They are not derived from a device fingerprint, IP address, account, email address, phone number, timetable token, or browser fingerprint.

A calendar-subscription request carries the anonymous UUID so the resulting subscription can be correlated with the product funnel without exposing its private bearer token. The server may also set the anonymous UUID in an HttpOnly first-party cookie for continuity.

## Accepted events and properties

`src/domain/analytics.ts` is the source of truth for the event-name and property allowlists. The ingestion API rejects unknown properties rather than accepting arbitrary JSON.

Properties are limited to operational primitives such as public timetable slug, provider, reminder preset, result/status, timetable or subscription identifier, version/session counts, and privacy-safe share method. Keys resembling tokens, credentials, authorization material, passwords, email addresses, phone numbers, push endpoints, or VAPID material are never accepted.

The database stores only coarse client classifications: desktop/mobile/tablet/other, Chrome/Safari/Firefox/Edge/other, and Android/iOS/Windows/macOS/Linux/other. Raw user-agent strings and IP addresses are not persisted. The request IP is used only ephemerally by the in-process rate limiter.

## Reliability behavior

The browser batches analytics and sends it asynchronously. Analytics errors never block timetable viewing, reminder selection, sharing, calendar setup, or feed delivery. Network or server failures can be retried from the bounded in-memory queue; malformed client data is dropped after the server rejects it.

Private calendar feed activity is not stored as one analytics event per refresh. Successful `200` and `304` requests are aggregated per subscription per UTC day. The aggregate stores counts, last-seen time, last status, and coarse client family only. The feed bearer token is never copied into analytics storage or logs.

## Server controls

`POST /api/analytics/events` has a strict event allowlist, strict property allowlist, UUID validation, a 32 KiB body limit, a maximum of 20 events per batch, a bounded client timestamp window, and an in-memory request rate limit. Database tables are unavailable to `anon` and `authenticated` database roles; writes use the server-side service role.

Operational failures are logged without request bodies, raw tokens, phone numbers, email addresses, push credentials, or raw user-agent strings.
