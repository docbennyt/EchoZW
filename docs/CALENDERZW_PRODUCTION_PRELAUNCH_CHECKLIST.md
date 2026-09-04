# CalenderZW production pre-launch checklist

Every item must be proven, not assumed.

## Brand

- [ ] Header uses the current CalenderZW mark and wordmark.
- [ ] Footer uses readable CalenderZW branding on dark background.
- [ ] Favicon, Apple touch icon, and web manifest icons load without 404s.
- [ ] Public copy does not contain stale `coming soon` language for features already live.
- [ ] Public claims use real data only.

## UX

- [ ] Every public page has one obvious primary action.
- [ ] `Find timetable` reaches a useful next state.
- [ ] Missing timetable state offers a lead/request path rather than a dead end.
- [ ] Public timetable shows publication context and problem-report path.
- [ ] No duplicate primary CTAs compete for attention in one viewport.

## Mobile

Test at 360, 390, 412, 768 px.

- [ ] No horizontal page overflow.
- [ ] Header navigation opens/closes and Escape behaviour works where applicable.
- [ ] Modal/bottom-sheet CTA remains visible without unreasonable scrolling.
- [ ] Google Calendar can be selected without entering a phone number.
- [ ] Form labels and validation remain visible above the mobile keyboard.
- [ ] Admin tables/cards remain usable without desktop-only squeezing.

## Forms

- [ ] Every input has a real label.
- [ ] Required fields are identified.
- [ ] Invalid state explains what to fix.
- [ ] Loading state prevents accidental duplicate submission.
- [ ] Success state confirms what happened.
- [ ] Optional phone collection is explicitly optional.

## Loading

- [ ] Public timetable loading preserves final geometry.
- [ ] Finder loading does not look like an empty/broken directory.
- [ ] Admin loading uses deliberate skeleton/progress state.
- [ ] Analytics loading does not collapse chart/card geometry.
- [ ] Source Gateway loading does not show stale controls as actionable.

## Errors

- [ ] No raw Postgres/Supabase/OAuth error reaches a student.
- [ ] Google OAuth failure returns the student to the originating timetable.
- [ ] Network failure offers retry where useful.
- [ ] Unknown public URL renders branded 404 content.
- [ ] Unknown public URL returns HTTP 404.
- [ ] Missing `/t/<slug>` returns HTTP 404 and `noindex`.

## Accessibility

- [ ] Page-level H1 is clear and unique on key public pages.
- [ ] Heading hierarchy is logical.
- [ ] Keyboard focus is visible.
- [ ] Icon-only controls have accessible names.
- [ ] Dialogs expose a meaningful title and can be dismissed safely.
- [ ] Colour is not the only signal for success/warning/error.
- [ ] Primary text/background combinations meet practical WCAG AA contrast.

## SEO

- [ ] `/robots.txt` returns text/plain and contains sitemap location.
- [ ] `/sitemap.xml` returns valid XML.
- [ ] Sitemap contains only canonical public/indexable URLs.
- [ ] `/llms.txt` contains only factual public information.
- [ ] Home has unique title/description/canonical.
- [ ] Finder has unique title/description/canonical.
- [ ] Support/legal pages have unique title/description/canonical.
- [ ] Published timetable has timetable-specific server metadata.
- [ ] OAuth/status query variants canonicalise to the clean timetable URL.
- [ ] Admin/account/OAuth callback surfaces are `noindex`.
- [ ] Legacy `/sync/<slug>` redirects to canonical `/t/<slug>`.
- [ ] Unknown URLs are not soft 404s.

## AI search

- [ ] Public pages intended for discovery do not block `OAI-SearchBot`.
- [ ] Private/admin/API/feed surfaces remain blocked from crawler discovery.
- [ ] `llms.txt` does not expose private URLs or internal endpoints.
- [ ] Product answers are factual and do not claim unsupported rankings/citations.

## Analytics

- [ ] Public analytics payloads contain no phone/email/token/private-feed URL.
- [ ] Calendar onboarding funnel events persist successfully.
- [ ] Organic/referral attribution uses sanitised fields only.
- [ ] Founder analytics API remains server-authorised.

## Performance

- [ ] Vite build chunk report reviewed.
- [ ] Public timetable does not load founder-only charting/admin bundles unnecessarily.
- [ ] Important images have explicit dimensions where applicable.
- [ ] Below-fold raster images are lazy loaded.
- [ ] Critical LCP asset is not lazy loaded.
- [ ] Font weights loaded match actual usage.
- [ ] No obvious CLS when timetable data arrives.

Target field CWV at 75th percentile:

- [ ] LCP ≤ 2.5 s
- [ ] INP ≤ 200 ms
- [ ] CLS ≤ 0.1

## Security

- [ ] HTTPS is enforced by production infrastructure.
- [ ] HSTS is present on production responses where intended.
- [ ] `X-Content-Type-Options: nosniff` present.
- [ ] Frame protection is present.
- [ ] Referrer policy is deliberate.
- [ ] Permissions Policy is deliberate.
- [ ] Admin APIs require server-side authorisation.
- [ ] Source relay secrets never appear in browser/API output.
- [ ] OAuth state cannot create an open redirect.
- [ ] Private feed tokens are never included in public analytics or sitemap.

## Calendar

- [ ] Apple subscription path still works.
- [ ] Google direct connection is capability-gated by production config.
- [ ] Google `Continue` is visible without optional phone entry.
- [ ] Google OAuth success syncs events.
- [ ] Google OAuth success returns to a clear success handoff.
- [ ] Google Calendar opens automatically where browser/OS permits.
- [ ] Manual `Open Google Calendar` fallback works.
- [ ] Back navigation does not create a reopen loop.
- [ ] Google OAuth failure/cancel returns to the original timetable.

## Source Gateway

- [ ] Accepted source snapshot persists immutably.
- [ ] Parser profile resolves explicitly.
- [ ] Discovered cohorts appear automatically.
- [ ] New cohort mapping requeues latest source processing.
- [ ] Mapped cohort generates an unpublished draft.
- [ ] No Source Gateway worker path auto-publishes.
- [ ] Admin reviews source-generated draft before publication.
- [ ] Class Rep corrections remain a separate resolved-schedule layer.

## Lead capture

- [ ] Missing timetable search has a request CTA.
- [ ] Request identifies institution/programme/class context.
- [ ] Class Rep/source-access lead can be captured.
- [ ] Contact consent is explicit and purpose-specific.
- [ ] Founder can view/action captured demand.
- [ ] Duplicate demand can be aggregated without IP/browser identity guessing.

## Legal

- [ ] Privacy Policy matches actual analytics/contact/calendar data collection.
- [ ] Terms match current product capabilities.
- [ ] Data deletion covers current Google/subscriber/contact data.
- [ ] Support email is current.
- [ ] No fake testimonial or aggregate rating is published.

## Social preview

- [ ] Home OG title/description/image render correctly.
- [ ] Published timetable OG title identifies institution/programme/class.
- [ ] WhatsApp preview remains readable at phone size.
- [ ] No private timetable/feed information appears in preview metadata.

## Browser QA

- [ ] Chrome Android
- [ ] Safari iPhone
- [ ] Samsung Internet where available
- [ ] Chrome desktop
- [ ] Edge desktop
- [ ] Safari desktop where available

## Deployment

- [ ] Exact release SHA recorded.
- [ ] Required migrations are applied before schema-dependent code promotion.
- [ ] `/api/health/ready` passes.
- [ ] Deployment smoke check passes.
- [ ] No environment secret printed in logs or screenshots.

## Post-deployment

- [ ] `/` live status/title/canonical checked.
- [ ] `/robots.txt` checked.
- [ ] `/sitemap.xml` checked.
- [ ] `/llms.txt` checked.
- [ ] `/find` checked on mobile.
- [ ] One published timetable checked on mobile.
- [ ] One unknown timetable checked for HTTP 404.
- [ ] Google OAuth end-to-end checked.
- [ ] Apple path checked.
- [ ] Search Console sitemap submitted/verified by a human with console access.
- [ ] No claim of indexing/ranking made until externally observed.
