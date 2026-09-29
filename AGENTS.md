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
