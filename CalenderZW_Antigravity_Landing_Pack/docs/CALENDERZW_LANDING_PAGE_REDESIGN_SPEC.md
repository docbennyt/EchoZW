# CalenderZW Landing Page Redesign Spec

## Objective

Redesign the public CalenderZW landing page into a flagship, mobile-first product experience with Cal.com-level clarity, Apple-level restraint and polish, Bedimcode-style interaction craft, and CalenderZW's own green/sage/cream/gold identity.

Borrow principles only. Do not copy external layouts, assets, wording, typography, or brand identity.

## Core positioning

**Your university timetable, already in your calendar.**

CalenderZW helps a student find their published class timetable, choose useful reminders, and add lectures to the calendar they already use.

Primary audience: Zimbabwean university students. Secondary: class representatives. Tertiary: universities/partners.

## Conversion

Primary CTA: **Find my timetable**

Secondary CTA: **See how it works**

Tertiary CTA later in the page: **Set up my class**

Do not make Admin, Sign up, Book demo, or Create workspace the hero CTA.

## Brand rules

Preserve exact spelling `CalenderZW`, current logo/icon, aiDo operator relationship, current deep green/sage/cream/gold palette, clean light UI, and current legal/Google-verification-safe identity.

Do not redesign the logo, use generic purple/blue SaaS gradients, imitate Cal.com visually, or fabricate university endorsements, ratings, testimonials, or user counts.

## Design character

Calm, precise, young but not childish, premium but not expensive, academic but not institutional, technical but not developer-only, fast, trustworthy, and intentional.

Avoid generic SaaS-template composition.

## Narrative

The visitor should move through:

1. I understand what this is.
2. I recognize the timetable problem.
3. It looks extremely easy.
4. I trust it.
5. It works with tools I already use.
6. I do not need another app/account for the core flow.
7. This can work for my class.
8. I should find my timetable now.

## Required sections

### Header

Desktop: readable brand, Find timetable, How it works, Calendar options, For class reps, quiet Admin link, strong Find my timetable CTA.

Mobile: readable logo/wordmark, compact primary action where space allows, accessible menu, no wrapping/overflow.

Scroll state should gain only a subtle surface/border, not a giant floating glass pill.

### Hero

Eyebrow direction: `YOUR TIMETABLE, ALREADY ORGANISED`

Headline: **Your university timetable, already in your calendar.**

Support: CalenderZW helps students find their class timetable, choose useful reminders, and add lectures to the calendar they already use.

Actions: Find my timetable / See how it works.

Microcopy: No app required · No student account needed for the core flow.

The first viewport must be understandable within seconds.

### Hero product scene

Use real product primitives rather than an abstract illustration. Show timetable card → Add to Calendar → reminder choice → calendar result. Build with responsive HTML/CSS UI where practical.

### Recognition / proof

Use only real evidence. If no verified metrics exist, use qualitative proof such as “Built in Zimbabwe for university life” and “One class link can serve an entire cohort.”

### Problem → outcome

Before: WhatsApp messages, PDFs, screenshots, forgotten changes.

After: one published timetable, reminders, one class link, calendar outcome.

Message direction: **Keep WhatsApp for conversation. Let your calendar remember the timetable.**

### How it works

1. Find your class.
2. Choose reminders.
3. Add it to your calendar.

Show product UI for each step. Desktop may use progressive/sticky storytelling; mobile should remain a clean vertical flow.

### Product proof

Heading direction: **Set it once. Let your calendar do the remembering.**

Show actual timetable → reminder → calendar behavior.

### Why no extra app?

Positive framing: **Your timetable shouldn't need another daily habit.**

Benefits: no app install for core flow, no student account for basic timetable access, one class link, calendar-native outcome, multi-institution direction.

Do not name competitors.

### Calendar options

Explain Apple Calendar, `.ics`, subscription links, and Google Calendar only to the extent actually supported. Do not imply verified one-tap mobile Google sync if it does not exist.

### Trust / accuracy

Heading direction: **Know what you're looking at.**

Show only real trust states such as Published, Community verified, Class-rep verified, Official. Never use Official without real institutional authority. Show last updated/published time and Report a problem.

### Real student conditions

Show that CalenderZW is fast on mobile data, readable on small phones, works without a student account for public timetable access, supports keyboard/screen readers, and respects reduced motion.

### Class reps

Heading direction: **Your class doesn't have a timetable yet?**

Explain that class reps can help keep one class schedule accurate and shareable. Do not expose superadmin complexity.

### Sharing

Demonstrate class link → WhatsApp group → classmates → calendars. Use public `/t/:slug` links only.

### Future value

Optional and restrained: **Timetables today. More of your academic schedule tomorrow.** Future chips may include Assignments, Tests, Exams, Academic reminders, clearly labeled as unreleased where applicable.

### Privacy / control

Keep concise: public timetable needs no student account, calendar connections are optional, private subscription links stay private, and Privacy/Data deletion remain available.

### Final CTA

Heading direction: **Find your class. Let your calendar handle the rest.**

Primary: Find my timetable. Secondary: Set up my class. Microcopy: Free for students.

### Footer

Homepage may use a full but compact marketing footer. Task routes such as `/t/:slug` should retain a compact application footer.

## Mobile-first requirements

Review at 320×568, 360×800, 375×812, 390×844, 412×915, 430×932.

At each width: no horizontal overflow, logo readable, intentional hero wraps, CTA clear, no tiny text, touch targets ~44px+, product scene legible, no giant dead space, footer compact.

## Desktop requirements

Review 768, 1024, 1280, 1440, 1600+.

Desktop must be intentionally recomposed, not a stretched phone. Use deliberate grids, asymmetry where useful, readable max-widths, and varied section rhythm. Avoid repeating heading + paragraph + three equal cards.

## Visual system

Reuse actual project tokens. Semantic roles: deep green for primary actions/selected state, gold sparingly, sage for quiet surfaces, cream/off-white canvas, white elevated surfaces, dark ink text, subtle neutral borders.

Prefer border → surface contrast → spacing → shadow.

## Motion

Motion should communicate state, hierarchy, cause-and-effect, and success. Prefer opacity, translate, small scale, restrained springs/masks/staggers. Avoid scroll hijacking, constant floating, wild parallax, large rotations, and animating every paragraph.

Signature animation: timetable → Add to Calendar → Prepared reminders → calendar event → ready.

Respect `prefers-reduced-motion`.

## Performance

Premium must remain fast on Zimbabwean mobile data. Do not add autoplay hero video, WebGL, giant imagery, multiple motion frameworks, or heavy dependencies for trivial effects. Prefer CSS/DOM product demos, responsive assets, lazy loading, existing icon libraries, and transform/opacity animation.

## Accessibility

Target strong WCAG 2.2 AA behavior: semantic headings/landmarks, keyboard navigation, visible focus, correct labels, screen-reader usability, touch targets, reduced motion, and no hover-only essential content.

## Google verification safety

Homepage must continue to visibly and consistently show CalenderZW, product purpose, aiDo as operator, optional Google Calendar usage where relevant, Privacy, Terms, Data deletion, and Support. Do not reintroduce branding mismatch problems.

## Route safety

Do not break `/`, `/find`, `/t/:slug`, `/admin`, `/admin/login`, `/calendar/*`, `/privacy`, `/terms`, `/data-deletion`, or `/support`.

Do not rewrite Supabase persistence, auth, timetable publication, calendar generation, or subscription security.

## Copy style

Concise, human, specific. Avoid “revolutionize”, “supercharge”, “game-changing”, “next-generation”, “seamless ecosystem”, and vague “empowering students” copy.

## Definition of done

1. Product understood in ~5 seconds.
2. Find my timetable is obvious.
3. 390px feels flagship.
4. 320px still works.
5. Desktop is intentionally recomposed.
6. Product UI demonstrates value.
7. Motion explains state.
8. Reduced motion works.
9. No fake claims.
10. CalenderZW brand remains clear.
11. Google/legal identity remains visible.
12. Existing routes work.
13. Tests/lint/build pass.
14. Performance impact reviewed.
