# CalenderZW production growth audit — 2026-09-04

Base SHA: `7accaac3c50e56507843a6a0b33dcdd5aeec92c5`

This audit is repository-grounded. The current tool environment could not resolve `calender.aido.co.zw` for an independent live HTTP fetch, so deployment/live claims remain separate from code findings.

## P0 — trust or conversion

- Google OAuth handoff had already been fixed and merged in PR #35 before this tranche. Do not duplicate that implementation.
- Missing-timetable demand capture is still a separate product tranche; `/find` currently discovers only published timetables and does not yet persist a demand lead when a class is absent.

## P1 — obvious production-quality defects

- No repository `robots.txt`, `sitemap.xml`, or `llms.txt` existed on the audited base.
- The production SPA shell used mostly generic metadata for non-timetable routes.
- Unknown SPA routes returned the app shell with HTTP 200, creating soft-404 behaviour.
- Missing `/t/<slug>` pages also returned a generic 200 shell when server-side timetable lookup failed.
- Legacy `/sync/<slug>` routes were accepted client-side but did not have a clean server canonical/redirect policy.
- Server metadata covered Open Graph basics but not a consistent robots directive or X/Twitter title/description/image metadata.
- `index.html` used a generic square manifest icon as the large social image. This is functional but not yet a strong WhatsApp share asset.

## P2 — polish and performance

- `AppV2.tsx` imports admin and public surfaces into one application module; students can still inherit avoidable public-bundle weight from admin code. Route-level code splitting should be a dedicated performance tranche.
- Base `AppV2.tsx` still contains older marketing copy for Google Calendar even though production UX enhancement work has made direct Google Calendar available. Consolidating enhancement layers back into canonical components is desirable, but should be done separately from technical SEO.
- Static legal/support pages have their own header/footer HTML and metadata; they should be kept aligned with the canonical CalenderZW design system and current product wording.
- A professional 1200×630 CalenderZW Open Graph asset should replace the square app icon in a later visual asset tranche.

## P3 — later expansion

- Institution/programme landing pages should only be introduced when backed by real published timetable or recorded demand data.
- A `/guides` content hub can support search demand, but should not become programmatic AI content spam.
- Search Console query data should eventually be joined conceptually with site-search demand and missing-timetable requests to drive expansion priority.

## Release principle

Search work must preserve the same production boundary as timetable work:

- public published timetable data may be indexed;
- drafts, private feed tokens, OAuth callbacks, admin routes, analytics, and source-ingestion internals must not be indexed;
- canonical URLs must remove callback/status/query noise;
- no public claim may be invented for SEO.
