# CalenderZW Search Console runbook

Production property:

`https://calender.aido.co.zw/`

## First setup

1. Add `calender.aido.co.zw` as a Google Search Console URL-prefix property, or use the parent `aido.co.zw` domain property if DNS-domain verification is already available and the team understands the broader scope.
2. Complete ownership verification using a method controlled by aiDo. Prefer DNS/domain verification where operationally convenient.
3. Submit:

   `https://calender.aido.co.zw/sitemap.xml`

4. Inspect the following URLs after deployment:

   - `/`
   - `/find`
   - `/support`
   - one known published `/t/<slug>` timetable
   - one intentionally missing `/t/<slug>` URL
   - `/robots.txt`

5. Confirm the published timetable URL is indexable and the intentionally missing timetable returns a real 404/noindex response.

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

## URL Inspection checklist

For each important page confirm:

- URL is on Google or eligible for indexing;
- Google-selected canonical matches the CalenderZW self-canonical;
- page is not blocked by robots.txt;
- page is not carrying a `noindex` directive;
- rendered page contains useful visible text;
- mobile rendering is usable;
- structured data, if present, matches visible content.

## Core Web Vitals

Monitor mobile and desktop separately. Target field performance at the 75th percentile:

- LCP: 2.5 seconds or better;
- INP: 200 ms or better;
- CLS: 0.1 or better.

Do not chase a synthetic score at the cost of product usability.

## Sitemap policy

The sitemap should include only canonical public pages and currently published timetable URLs.

Exclude:

- admin routes;
- OAuth callbacks;
- account setup/settings;
- APIs;
- private calendar feed/download URLs;
- unpublished timetable drafts;
- Source Gateway internals;
- analytics;
- query-parameter callback variants.

## Subdomain policy

Treat CalenderZW as a real standalone search property even while it lives at `calender.aido.co.zw`.

Use contextual links from `https://aido.co.zw/` and relevant aiDo pages to CalenderZW where editorially appropriate. Do not point CalenderZW canonicals at the parent aiDo site.

## Do not claim what has not been verified

Code can make the site Search Console-ready. It cannot prove:

- sitemap submission;
- indexing;
- ranking;
- AI Overview inclusion;
- ChatGPT/Perplexity citation;

without actual external verification.
