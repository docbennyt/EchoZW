# Repository rules for coding agents

These rules apply to every coding agent, automation, reviewer, or contributor working in this repository.

## P0 deployment invariant — Vite SPA shell and hashed assets must share one release owner

**STRICT RULE — NEVER VIOLATE THIS:** Railway may provide APIs and server-generated auxiliary resources, but Railway must never serve the Vite SPA HTML shell while Vercel serves that shell's hashed JS/CSS assets.

Practical consequences:

- Vercel owns frontend document routes and the Vite SPA shell.
- Railway may own backend-only endpoints such as `/api/*`, `/runtime-config.js`, `/sitemap.xml`, and other explicitly server-owned resources that do not return the Vite SPA shell.
- Never add or restore Vercel rewrites that proxy `/find`, `/t/:path*`, `/admin/:path*`, `/`, or another client-side document route to Railway.
- Do not restore Railway-generated SPA HTML/SEO injection unless HTML and all hashed frontend assets are guaranteed to come from the same atomic release/origin.
- `tests/vercelSpaAssetOrigin.test.ts` is an architecture guardrail. Do not delete, weaken, or bypass it to make a routing change pass.
- Any change to `vercel.json`, Railway routing, Vite output, reverse proxies, SSR/SEO injection, or frontend deployment topology must preserve this invariant.

Why: Railway and Vercel deploy independently. If Railway serves an older `index.html` referencing `/assets/index-OLDHASH.js` while Vercel has a newer release, the missing JS request can fall through to SPA `index.html` as `text/html`. The browser then rejects the module on MIME type and the app becomes a blank white page. This has caused repeated P0 incidents.

See `docs/ARCHITECTURE.md` for the full deployment contract.

## Change discipline

- Prefer surgical changes over broad rewrites.
- Preserve established security, authorization, versioning, and publication gates unless the issue explicitly changes them.
- Do not weaken regression tests to accommodate an architecture violation.
- Before changing deployment topology, inspect current production ownership and verify the exact route/asset contract.

## Cloudflare migration rules

The migration target is one atomic Cloudflare Worker + Static Assets release. During migration, the current Vercel/Railway production topology remains authoritative until an explicit cutover gate is approved.

- Cloudflare may temporarily proxy backend-only routes to Railway on staging/Preview, but it must never proxy browser SPA HTML to Railway.
- Missing hashed assets under `/assets/*` must return a real 404. They must never fall through to `index.html`.
- Do not recreate persistent `setInterval`/polling workers in Cloudflare. Source processing and push delivery must become event/Queue-driven; Cron is recovery/reconciliation only.
- Do not query Supabase and regenerate public ICS on every subscriber poll once a materialized R2 artifact exists.
- Keep Supabase as PostgreSQL/Auth/RLS for this migration. Do not introduce D1 as a parallel source of relational truth.
- Raw timetable evidence and materialized large artifacts belong in R2; structured metadata/review/version state belongs in Supabase.
- Preserve the repaired invitation state machine: staff invitation is never password recovery.
- Class Rep permissions remain scoped to explicitly assigned timetables.
- Static document imports remain review/draft-first and must never auto-publish ambiguous source data.
- High-risk migration PRs require human review and must not auto-merge.

See `docs/CLOUDFLARE_ZERO_COST_MIGRATION_RUNBOOK.md` and the DR-152+ Linear migration project before changing runtime topology.
