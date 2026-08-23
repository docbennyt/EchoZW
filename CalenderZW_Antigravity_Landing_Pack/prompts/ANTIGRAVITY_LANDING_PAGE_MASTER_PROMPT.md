# Antigravity Multi-Agent Prompt — CalenderZW Landing Page Flagship Redesign

You are working inside the CalenderZW repository. A folder named `Calender VPS` has already been added to the repo. Inspect the real repository before changing anything.

Read first:

1. `docs/CALENDERZW_LANDING_PAGE_REDESIGN_SPEC.md`
2. `docs/CALENDERZW_VISUAL_MOTION_SYSTEM.md`
3. `docs/CALENDERZW_LANDING_PAGE_QA_ACCEPTANCE.md`
4. `Progress.md` if present
5. actual package/config/routes/styles/components

## Mission

Implement the public landing-page redesign to a flagship quality bar: Cal.com-level product clarity, Apple-level restraint and polish, Bedimcode-style responsive interaction craft, uniquely CalenderZW, mobile-first, fast, accessible, clean light UI, and no backend regressions.

Do not merely propose a design. Modify, run, inspect, test, and fix the repository.

## Multi-agent operating model

Avoid multiple agents editing shared files blindly.

### Agent 1 — Lead / implementation owner

Owns repository audit, shared design tokens, homepage composition, shared shell integration, final convergence, and all global/shared-file edits.

### Agent 2 — Mobile UX reviewer

Read-only first. Audit 320, 360, 375, 390, 412, 430 widths. Return precise findings on overflow, hierarchy, line wrapping, CTA visibility, touch targets, product-scene readability, footer size, and mobile menu.

### Agent 3 — Desktop / visual-systems reviewer

Audit 768, 1024, 1280, 1440, 1600+. Check grid, spacing, typography, card fatigue, product scenes, nav, and section rhythm. Return findings to Lead.

### Agent 4 — Accessibility / performance reviewer

Audit keyboard, focus, heading order, reduced motion, contrast, dependencies, assets, CLS, motion cost, and route performance. Return must-fix findings.

### Agent 5 — Conversion / content reviewer

Audit five-second comprehension, Find my timetable prominence, no fake claims, no stale brand copy, Google-verification-safe identity, class-rep CTA timing, and trust.

### Convergence

Lead implements/reconciles reviewer findings. No reviewer should create a competing redesign. If Antigravity supports separate branches/worktrees, use them only for non-overlapping isolated work; shared theme/global CSS/header/footer has one owner.

## Repository inspection

Inspect framework/build tooling, `package.json`, homepage route, router, global CSS, design tokens, icon library, motion libraries, header/footer, metadata, raw/no-JS identity, legal routes, and tests. Do not assume file paths or frameworks.

## Preserve functionality

Do not break `/`, `/find`, `/t/:slug`, `/admin`, `/admin/login`, `/calendar/*`, `/privacy`, `/terms`, `/data-deletion`, or `/support`.

Do not rewrite Supabase, auth, timetable publication, calendar generation, or subscription logic.

## Core positioning

Hero must communicate:

**Your university timetable, already in your calendar.**

Primary CTA: **Find my timetable**

Secondary CTA: **See how it works**

Microcopy: **No app required · No student account needed**

Admin stays visually secondary.

## Homepage narrative

Implement the structure from the redesign spec. Do not use a generic hero → logo cloud → three cards → testimonials → pricing → FAQ template.

## Product demonstration

Build timetable → Add to Calendar → reminder selection → calendar result with crisp HTML/CSS product UI. Do not use generic abstract SaaS graphics.

## Motion

Implement one signature product-state interaction. Use CSS first and existing motion tooling when already installed. Add no heavy dependency solely for decoration. Respect `prefers-reduced-motion`.

## Mobile-first implementation order

Start around 390px. Then verify 320, 360, 375, 412, 430. Only then refine 768, 1024, 1280, 1440, 1600+.

Do not build desktop first and stack afterward.

## Visual quality

Avoid purple/blue SaaS gradients, giant blobs, every item inside a rounded card, excessive shadows, emoji icons, mixed icon families, giant startup typography, and constant floating animation.

Use deep green as primary anchor, sage/cream surfaces, gold sparingly, strong typography, whitespace, crisp product UI, subtle borders, and deliberate section rhythm.

## Header

Desktop: brand, useful nav, strong Find my timetable CTA, quiet Admin.

Mobile: readable brand, compact primary action where space allows, accessible menu, no wrap/overflow.

## Footer

Homepage may use full marketing footer. Task pages remain compact. Do not let footer dominate mobile.

## Google brand-verification safety

Do not remove or obscure CalenderZW identity, product purpose, aiDo operator relationship, Privacy, Terms, Data deletion, Support, or accurate optional Google Calendar explanation. Remove stale Echo branding.

## Performance

No autoplay video, WebGL, giant media, or multiple motion frameworks. Audit bundle impact. Premium must remain fast on mobile data.

## Accessibility

Target strong WCAG 2.2 AA behavior. Verify keyboard, visible focus, semantic headings, labels, reduced motion, touch targets, and no hover-only essential content.

## Tests + QA

Run actual repo scripts found in `package.json` for tests/lint/format/build. Use browser/screenshots if available. Review the real rendered page at the required mobile and desktop widths rather than trusting source alone.

## Completion gate

Do not call complete unless:

1. Product is understood in ~5 seconds.
2. Find my timetable is obvious.
3. 390px feels flagship.
4. 320px works.
5. Desktop is intentionally recomposed.
6. Product demonstration is clear.
7. Motion adds meaning.
8. Reduced motion works.
9. No fake claims.
10. CalenderZW identity preserved.
11. Legal/Google identity preserved.
12. Product routes work.
13. Tests/lint/build pass.
14. Performance impact reviewed.

## Final response

Return:

### Design direction
Short summary.

### Implemented sections
List.

### Mobile verification
320 / 360 / 390 / 412 / 430.

### Desktop verification
1024 / 1280 / 1440 / 1600+.

### Motion
Implementation + reduced-motion behavior.

### Conversion
Primary/secondary journey.

### Accessibility
Keyboard/focus/reduced motion.

### Performance
Dependencies/media/bundle impact.

### Google branding safety
Identity/purpose/legal visibility.

### Route regression
Results.

### Tests
Results.

### Remaining issues
Only genuine blockers.

Do not return only a proposal. Implement and verify.
