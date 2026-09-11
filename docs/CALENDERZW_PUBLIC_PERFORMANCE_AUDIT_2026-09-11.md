# CalenderZW public performance audit — 2026-09-11

## Scope

This audit covers the final public student path after DR-63/DR-64/DR-66 simplification and the DR-68 SEO hardening work. It is intentionally limited to regressions or avoidable work that can be attributed to the public route and this tranche; it is not a broad code-splitting rewrite.

Audited surfaces:

- `/`
- `/find`
- published `/t/<slug>`
- `/t/<slug>/google` metadata shell
- static crawl/share assets used by those routes

## Findings and actions

### Server-visible SEO work adds no client render work

DR-68 resolves timetable metadata on the production server before returning the SPA shell. The exact-class title, description, canonical, Open Graph and Twitter/X tags do not add React components, hydration work, client fetches or layout work to the student page.

The new `server/spaSeo.ts` boundary also makes query canonicalization and 404/noindex behavior testable without moving that logic into the browser.

### Social image is purpose-built and lightweight

The previous social metadata reused the square 512×512 app/manifest image. DR-68 replaces that with one dedicated `1200×630` CalenderZW share card.

The committed PNG is 34,172 bytes. It is referenced from metadata and is not inserted into the visible student layout, so normal page rendering does not wait for it. Automated tests lock both dimensions and a sub-100 KB budget.

### Font loading

The public shell already preconnects to both Google Fonts hosts and requests Plus Jakarta Sans with `display=swap`. DR-68 does not add another font family, another weight, or a second font stylesheet.

Changing the brand font or forcing a new self-hosting strategy in this tranche would create a wider visual/release surface without evidence that DR-68 caused a regression. The existing loading strategy is therefore retained. Field CLS/LCP still needs to be watched after deployment through Search Console and browser tooling.

### Removed enhancement layers were not reintroduced

DR-68 does not re-add the mobile browse rails, extra timetable catalogue surfaces, duplicated public-preview layouts, or conversion-step layers removed/consolidated by the preceding public UX work. The SEO changes remain outside the React render tree.

### JavaScript and CSS

DR-68 introduces no new client dependency and changes no package or lock file. The production build continues to report the repository's existing large-main-chunk warning. That warning predates DR-68 and is not evidence of a regression caused by exact-class SEO.

A broad route-splitting project is deliberately not mixed into this issue. If field or reproducible lab data shows the public student route is materially harmed by the shared bundle, it should be handled as a separately measured performance tranche.

### Static assets

The audit found a large legacy `public/favicon.svg`, but the production HTML currently references the ICO/96×96 PNG/favicon and Apple touch assets instead of that SVG. DR-68 therefore does not change or delete the legacy file without a separate asset-usage audit.

The new share card is materially smaller than the existing large logo/source assets and does not enter the critical visible render path.

## Reliability boundaries preserved

Performance work in this tranche does not alter:

- published timetable resolution;
- calendar subscription/feed semantics;
- stable session identity or publication versions;
- authentication or authorization;
- finder publication trust rules;
- 404/noindex behavior for missing timetables.

No synthetic-score optimization is allowed to weaken those guarantees.

## Verification before merge

Required CI gates:

1. `npm ci`
2. lint
3. Prettier check
4. full test suite, including DR-68 server metadata/sitemap/share-image coverage
5. production build

The final CI log is the source of truth for bundle output and warnings for this commit.

## Verification after deployment

The code audit cannot establish field performance or Google indexing. After deployment, follow `docs/CALENDERZW_SEARCH_CONSOLE_RUNBOOK.md` and record:

- sitemap fetch status;
- URL Inspection for `/`, `/find`, one published timetable and one missing timetable;
- Google-selected canonical for a representative timetable and a query-string variant;
- mobile usability;
- Core Web Vitals when enough field data exists;
- a mobile and desktop browser/Lighthouse check for unexpected LCP, CLS or render-blocking regressions.

Do not claim a Core Web Vitals pass, indexing, ranking or Search Console success until those external checks have actually been performed.
