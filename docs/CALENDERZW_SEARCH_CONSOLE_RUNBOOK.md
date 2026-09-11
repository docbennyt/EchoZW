# CalenderZW Search Console runbook

Production property:

`https://calender.aido.co.zw/`

## First setup

1. Add `calender.aido.co.zw` as a Google Search Console URL-prefix property, or use the parent `aido.co.zw` domain property if DNS-domain verification is already available and the team understands the broader scope.
2. Complete ownership verification using a method controlled by aiDo. Prefer DNS/domain verification where operationally convenient.
3. Submit `https://calender.aido.co.zw/sitemap.xml` and confirm Google can fetch it successfully.
4. Inspect the following URLs after deployment:
   - `/`
   - `/find`
   - `/support`
   - one known published `/t/<slug>` timetable
   - the same published timetable with a harmless query string such as `?utm_source=search-console-check`
   - `/t/<same-slug>/google`
   - one intentionally missing `/t/<slug>` URL
   - `/robots.txt`
5. Confirm the published timetable is indexable and the intentionally missing timetable returns a real HTTP 404 with `noindex, nofollow`.

## Exact-class metadata verification

For the representative published timetable, inspect the raw server response as well as the rendered page. Confirm:

- `<title>` contains the real institution, programme and class context and ends with `| CalenderZW`;
- the description names the real academic period and exact class context without keyword stuffing;
- Open Graph and Twitter/X title and description match the exact class context;
- `og:image` and `twitter:image` point to `https://calender.aido.co.zw/calenderzw-share-1200x630.png`;
- the share image is the dedicated 1200×630 CalenderZW card, not a square app icon;
- the canonical is the query-free `/t/<slug>` URL even when the requested URL contains UTM, share or callback parameters;
- `/t/<slug>/google` remains `noindex, nofollow` and canonicals back to `/t/<slug>`;
- no private calendar feed URL or OAuth parameter appears in crawlable metadata.

Do not mark a semester timetable as one schema.org `Event`. The site-level Organization, WebSite and WebApplication markup may remain when it truthfully describes visible product context.

## URL Inspection checklist

For each important page confirm:

- URL is on Google or eligible for indexing;
- Google-selected canonical matches the CalenderZW self-canonical;
- query-string variants resolve to the same query-free canonical;
- page is not blocked by robots.txt;
- page is not carrying a `noindex` directive unless it is intentionally private/non-indexable;
- rendered page contains useful visible text;
- mobile rendering is usable;
- structured data, if present, matches visible content.

For the deliberately missing timetable, verify Google sees a true 404 rather than a soft 404 or indexable SPA shell.

## Mobile usability and Core Web Vitals

Monitor mobile and desktop separately. Target field performance at the 75th percentile:

- LCP: 2.5 seconds or better;
- INP: 200 ms or better;
- CLS: 0.1 or better.

During each release check:

1. Inspect the representative timetable on a mobile viewport and confirm the primary class/calendar content does not jump after the initial render.
2. Check Search Console mobile usability for the representative timetable and `/find`.
3. Review Core Web Vitals for regressions after enough field data exists.
4. Use Lighthouse or another synthetic tool only as supporting evidence; do not trade reliability or truthful UX for a synthetic score.

## Sitemap policy

The sitemap should include only canonical public pages and currently published timetable URLs.

Exclude:

- admin routes;
- OAuth callbacks and `/t/<slug>/google`;
- account setup/settings;
- APIs;
- private calendar feed/download URLs and tokens;
- unpublished timetable drafts;
- Source Gateway internals;
- analytics;
- query-parameter callback/share variants.

After each material SEO deployment, fetch `/sitemap.xml` directly and confirm a known published timetable is present while a draft/private URL is absent.

## Weekly founder review

Review Search Console by:

- Queries
- Pages
- Devices
- Countries
- Search appearance

Track separately:

- branded queries containing CalenderZW;
- institution queries such as `HIT timetable`;
- programme queries such as `HIT Software Engineering timetable`;
- calendar-intent queries such as `add university timetable to Google Calendar`;
- non-brand discovery queries.

## Expansion signal

Do not expand based only on impressions. Combine:

1. Search impressions/clicks for an institution or programme;
2. CalenderZW finder/search demand;
3. missing-timetable requests;
4. Class Rep or source-access leads;
5. Source Gateway parser/source feasibility.

A programme with search demand plus a real Class Rep/source path is a stronger expansion target than a high-impression keyword with no operational route to student truth.

## Subdomain policy

Treat CalenderZW as a real standalone search property even while it lives at `calender.aido.co.zw`.

Use contextual links from `https://aido.co.zw/` and relevant aiDo pages to CalenderZW where editorially appropriate. Do not point CalenderZW canonicals at the parent aiDo site.

## Do not claim what has not been verified

Code can make the site Search Console-ready. It cannot prove any of the following without external verification after deployment:

- sitemap submission or successful Search Console processing;
- indexing;
- ranking;
- Core Web Vitals field pass status;
- AI Overview inclusion;
- ChatGPT/Perplexity citation.

Record the inspection date and representative URL when the team performs the external verification so future regressions can be compared against a concrete baseline.
