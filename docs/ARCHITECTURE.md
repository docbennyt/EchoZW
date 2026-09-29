# Architecture

CalenderZW is a React/Vite SPA with domain logic separated from UI components and a split frontend/backend deployment:

- Vercel owns the public Vite SPA document shell and its hashed frontend assets.
- Railway owns server/API execution and backend-generated auxiliary resources.
- Supabase/Postgres owns application persistence, authorization data, review/version state, and database functions.

## Non-negotiable deployment invariant: one owner for the SPA shell and its hashed assets

**STRICT RULE — NEVER VIOLATE THIS:** Railway may provide APIs and server-generated auxiliary resources, but Railway must never serve the Vite SPA HTML shell while Vercel serves that shell's hashed JS/CSS assets.

This applies to every frontend document route, including `/find`, `/t/*`, `/admin/*`, `/`, and any future client-side route. Frontend document routes must resolve to the Vercel release that also owns the Vite-generated `/assets/index-<hash>.js` and `/assets/index-<hash>.css` referenced by that HTML.

Allowed Vercel-to-Railway rewrites are backend-only resources such as:

- `/api/*`
- `/runtime-config.js`
- `/sitemap.xml`
- another explicitly server-owned endpoint that does not return the Vite SPA shell

Forbidden topology:

```text
browser -> Vercel /find or /t/* rewrite -> Railway index.html
                                     |
                                     `-> /assets/index-<hash>.js requested from Vercel
```

Railway and Vercel deploy independently. If Railway serves an HTML shell produced by release A while Vercel serves frontend assets from release B, the HTML can reference a hashed asset Vercel does not have. Vercel's SPA fallback can then return `text/html` at the missing `.js` URL, causing the browser's strict module MIME check to abort application startup and produce a blank white page.

Therefore:

1. Do not add Vercel rewrites that proxy `/find`, `/t/:path*`, `/admin/:path*`, `/`, or any other SPA document route to Railway.
2. Do not restore server-side SPA HTML/SEO injection on Railway unless the architecture is changed so the HTML shell and all hashed assets are guaranteed to come from the same atomic release/origin.
3. Keep `tests/vercelSpaAssetOrigin.test.ts` as a release gate. If a proposed change makes it fail, fix the architecture; do not weaken or delete the test merely to make CI pass.
4. Any coding agent touching `vercel.json`, Railway routing, Vite output ownership, CDN/proxy behavior, SSR/SEO injection, or frontend deployment must preserve this invariant.
5. A production smoke for `/find` and at least one `/t/:slug` route must remain part of release verification whenever routing/deployment topology changes.

This invariant exists because it has caused repeated P0 blank-page incidents. Treat violations as release-blocking architecture defects.

## Code layout

- `src/config`: product configuration and feature flags.
- `src/domain`: timetable types, seed data, reminders, next-event calculation, validation, and calendar generation.
- `src/integrations`: provider interfaces for external integrations and timetable extraction adapters.
- `server`: backend/API execution and server-only integrations.
- `supabase`: database migrations and database-side contracts.
- `src/App.tsx`: public routes, dashboard scaffold, sync wizard, and reporting UI.
