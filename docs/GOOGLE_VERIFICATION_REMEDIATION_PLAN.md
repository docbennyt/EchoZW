# Google Verification Remediation Plan

## Audit Findings

- Architecture: Vite React SPA with a Node production server and static public legal pages.
- Current root route: previously fell through to the shared timetable page; it must be the public product homepage.
- Timetable route: `/t/zou-bscse-2-1-2026-s2` is already used by timetable cards and admin preview.
- Logo assets: CalenderZW icon and wordmark assets exist in `branding/` and `public/`; the app uses the square icon from public assets.
- Legal values: Zimbabwe governing-law values are now configured in code defaults.
- OAuth scope: code uses `https://www.googleapis.com/auth/calendar.app.created`.
- OAuth flow: Google connection is initiated only after the Quick Add flow and an in-product disclosure.
- Domain ownership: cannot be completed by code; it requires Google Search Console DNS verification by the operator.

## Remediation Phases

1. Identity: centralise CalenderZW by aiDo brand constants and replace visible legacy names.
2. Homepage: make `/` a direct public product homepage with purpose, audience, supported calendars, and Google access disclosure.
3. Routes: keep shared timetables on `/t/:slug` and canonicalise timetable metadata to that route.
4. Legal: remove unresolved legal-review language and render Zimbabwe governing law and venue.
5. OAuth: preserve only `calendar.app.created`, keep pre-consent disclosure before redirect, and document external setup values.
6. Verification: add Search Console instructions, OAuth submission document, readiness page, and automated checks.

## External Dependency

Google Search Console domain ownership for `aido.co.zw` remains external and must be confirmed by an operator with suitable Google Cloud project permissions.
