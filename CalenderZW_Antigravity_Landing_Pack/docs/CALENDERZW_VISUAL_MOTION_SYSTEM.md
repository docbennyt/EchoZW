# CalenderZW Visual + Motion System

## Preserve existing tokens

Inspect current theme, fonts, icon library, radii, shadows, and spacing before adding new CSS. Reuse rather than create a competing design system.

## Color roles

- Deep green: primary CTA, selected states, important emphasis.
- Gold: sparse highlight, never every CTA.
- Sage: quiet supporting surfaces.
- Cream/off-white: main canvas.
- White: elevated product surfaces.
- Ink: primary text.
- Quiet neutral: borders/secondary text.

## Typography

Use a responsive hierarchy: hero display, section title, product/card title, lead, body, metadata, button. Keep mobile hero compact enough that the value proposition and CTA appear early. Maintain comfortable line-height and controlled paragraph width.

## Spacing

Use the existing token system or a 4/8-based rhythm. Typical mobile gutters ~18–22px, card padding ~16–20px, primary controls ~48–52px tall. Do not use identical spacing everywhere.

## Radius + shadow

Use small/medium/large semantic radii rather than one huge radius. Prefer border, surface contrast and spacing before shadow. Keep shadows subtle.

## Buttons

Primary: deep green/high contrast. Secondary: light surface/border. Tertiary: text/link. Provide clear hover, pressed and visible keyboard-focus states. Press motion should be subtle and fast.

## Motion timing

- Fast feedback: ~120–200ms.
- Standard transitions: ~220–360ms.
- Section reveals: ~400–700ms.

Prefer restrained ease-out/cubic-bezier/low-overshoot spring behavior.

## Signature hero motion

1. Timetable card appears.
2. Add to Calendar activates.
3. Prepared reminder resolves.
4. Calendar event appears.
5. Success state resolves.

Requirements: understandable without animation, no layout shifts, reduced-motion fallback, no video dependency.

## Scroll reveals

Use one coherent reveal language: small vertical movement + opacity + grouped stagger. Do not animate every nested node separately.

## Responsive composition

320–430: one-column narrative, CTA early, product scene attached to hero, vertical how-it-works, compact footer.

768: transitional two-column layouts where natural.

1024+: intentional asymmetry, wider product scenes, sticky storytelling only where useful.

1440+: scale whitespace/composition rather than paragraph line length.

## Product scenes

Prefer real UI primitives: timetable event cards, reminder selector, trust badge, calendar output, public share card. Avoid unreadable screenshots inside fake phones when HTML/CSS can explain the product more clearly.

## Performance guardrail

Before adding a dependency ask: Is it already installed? Can CSS/DOM do it? Does it materially improve the signature interaction? Is bundle cost justified?

Avoid WebGL, autoplay video, multiple motion libraries, heavy sliders, and giant icon packages.

## Accessibility

Respect reduced motion, visible focus, keyboard navigation, proper labels, adequate contrast, and no essential hover-only behavior.

## Final visual review

For every section inspect alignment, spacing, line wrapping, contrast, radius, icon consistency, CTA hierarchy, motion, reduced motion, mobile overflow, and desktop whitespace. If it only works at one screenshot width, it is unfinished.
