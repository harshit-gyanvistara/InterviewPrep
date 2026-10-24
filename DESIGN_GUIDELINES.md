# micro1.ai — Design Guidelines & Standards

Reverse-engineered from the live site (`www.micro1.ai`, Webflow-built). Based on
the production stylesheet's CSS custom properties, typographic scale, component
classes, and background-treatment patterns.

## 1. Design Principles

1. **Dark-first, premium-SaaS tone.** Default surface is near-black
   (`#121212`), not pure black — softer, more "studio" than "terminal."
   Content reads as white/off-white on dark, which reads as confident and
   high-end rather than playful.
2. **Depth through light, not through heavy shadows.** Hierarchy comes from
   blurred gradient glows, soft noise/grain texture, and backdrop blur —
   rarely from drop shadows with hard edges. The one hard-edge shadow pattern
   that appears is a thin `0 0 0 1px` hairline border used for focus/definition.
2b. **Glow + grain over flat gradients.** Hero and section backgrounds layer:
   a background image → noise/grain texture overlay (tiled webp, ~150–250px
   tile, opacity ~0.5) → a large blurred radial "glow" shape
   (`filter: blur(25–40px)`, `border-radius: 50%`) → a `backdrop-filter: blur()`
   pane on top. This is the single most distinctive visual signature of the
   site — it's what keeps flat dark sections from feeling empty.
3. **One accent color, used sparingly.** Brand purple/indigo (`#7065f0`) is
   reserved for links, primary CTAs, and highlight states — not for large
   fills. Most of the UI is monochrome (white-on-black at varying opacity).
4. **Opacity-based elevation, not new colors.** Text and surface hierarchy is
   built by taking white/black at different alpha values (90%, 80%, 70%,
   60%, 40%, 20%, 10%, 6%, 3%) rather than introducing new greys. This keeps
   every layer tonally related to its background.
5. **Soft geometry.** Border-radius is used generously and intentionally at
   two extremes: small functional radii (4–14px) for cards/inputs, and fully
   pill-shaped (`border-radius: 45rem`) for buttons and tags. Nothing is
   sharp-cornered.
6. **Motion is quiet.** Transitions are short (0.1–0.3s) and apply to color/
   background/box-shadow only — no springy or decorative motion. Interactivity
   should feel immediate, not performative.
7. **Type carries the brand.** A single variable font family (Outfit) does
   all the work, from hero headlines to body copy — weight and size carry
   hierarchy, not font-switching.

## 2. Color System

### 2.1 Base palette (raw values)

| Token | Value | Use |
|---|---|---|
| `base-color-grey--100` | `#121212` | Default body background (dark surface) |
| `base-color-white--100` | `#fff` | Max-contrast text / icons |
| `base-color-black--100` | `black` | Max-contrast on light surfaces |
| `base-color-light--primary` | `#ebebf4` | Light-mode / inverted-section background |
| `base-color-brand--primary` | `#7065f0` | Primary accent (buttons, links, focus) |
| `base-color-brand--dark` | `#474cb8` | Accent hover/active, dark variant |
| `base-color-brand--light-1` | `#9fa3fc` | Link color on dark backgrounds |
| `base-color-brand--light-2` | `#caccfd` | Lighter accent / illustration tint |
| `base-color-brand--light-3` | `#e2e2fd` | Lightest accent tint |
| `base-color-system--green` | `#568758` | Success |
| `base-color-system--green-light` | `#daffe0` | Success background |
| `base-color-system--red` | `#f86567` | Error |
| `base-color-system--red-light` | `#ffe5e5` | Error background |
| `base-color-system--warning-yellow` | `#fcf8d8` | Warning background |
| Gradient accents | `#6d7cff`, `#6390f0`, `#6541dc` (all at ~20% alpha) | Decorative glows only |

### 2.2 Opacity ramps (the real workhorse of the palette)

Rather than naming many greys, white and black are stepped by alpha and reused
for every hierarchy decision:

- **White ramp:** 100% (pure white) · 90% · 80% · 70% · 60% · 40% · 30% · 20%
  · 15% · 10% · 8% · 6% · 3% · transparent
- **Black ramp:** 100% · 70% · 60% · 40% · 20%

**Mapping (semantic tokens → ramp):**

| Semantic token | Resolves to |
|---|---|
| `text-color--text-primary` | white 90% |
| `text-color--text-secondary` | white 60% |
| `text-color--text-tertiary` | white 60% |
| `text-color--text-white` | white 100% |
| `background-color--primary` | white 6% |
| `background-color--secondary` | white 10% |
| `border-color--primary` | white 10% |
| `border-color--secondary` | white 20% |
| `link-color--primary` | brand light-1 |

**Rule of thumb:** primary text = 90% white, secondary/supporting text = 60%
white, subtle UI fills = 6–10% white, visible-but-quiet borders = 10–20%
white. Never introduce a new grey hex — compose from this ramp.

### 2.3 Usage rules

- Backgrounds default dark (`grey-100`); a light/"inverted" section uses
  `light-primary` (`#ebebf4`) instead of true white, keeping even the light
  mode slightly muted.
- Brand purple is a **call-to-action and link color**, not a background fill.
  Large colored surfaces don't happen — color is applied to small, high-intent
  elements only.
- System colors (green/red/yellow) always pair a saturated foreground with a
  very light, near-pastel background (e.g. red `#f86567` text on `#ffe5e5`
  background) — never a saturated fill with white text.

## 3. Typography

**Typeface:** Outfit (variable, weights 100–900), served as a single woff2.
Fallback stack: `Outfit, Arial, sans-serif`. No secondary/serif typeface is
used anywhere in the system — one family for display, body, and UI text.

### Scale (desktop → mobile, where it collapses)

| Style | Desktop | Mobile | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| Hero | 4rem (64px) / `7.5vw` fluid | — | 400 | 1.2–1.3 | −0.02em |
| H1 | 3.25rem (52px) | 1.9rem (30px) | 500 | 1.2 | −0.02em |
| H2 | 2.75rem (44px) | 1.6rem (26px) | 500 | 1.3 | −0.025em |
| H3 | 2.25rem (36px) | 1.3rem (21px) | 400 | 1.3–1.4 | −0.015em |
| H4 | 1.75rem (28px) | 1.2rem (19px) | 400 | 1.4 | −0.01em |
| H5 | 1.5rem (24px) | 1.125rem (18px) | 400 | 1.3–1.5 | — |
| Body / large | 1.25rem (20px) | 1rem (16px) | 400 | 1.6 | — |
| Body / medium | 1.125rem (18px) | 1rem (16px) | 400 | 1.6 | — |
| Body / regular | 1rem (16px) | 1rem (16px) | 400 | 1.5 | — |
| Body / small | 0.875rem (14px) | — | 400 | 1.6 | — |

**Principles:**
- Headings get negative letter-spacing (−0.01 to −0.025em); body text does
  not — tightened headlines feel designed, loose body text stays readable.
  The bigger the heading, the more negative the tracking.
- Heading weight is **500 for H1/H2, 400 for H3 and below.** Weight, not
  size, marks the top two levels as "stronger"; below that, size alone
  carries hierarchy and weight stays at regular.
- Every mobile step drops one tier roughly 30–40%, but never below ~1rem for
  body copy — no text goes smaller than 14px.

## 4. Shape & Geometry

| Radius | Typical use |
|---|---|
| 2–4px (`.125–.25rem`) | tags, small badges, checkboxes |
| 6–8px (`.375–.5rem`) | inputs, small cards |
| 10–14px (`.625–.875rem`) | cards, panels, modals |
| 20–28px (`1.25–1.75rem`) | large feature cards, hero panels |
| `45rem` (fully round) | **all buttons and pill tags** — the signature shape |

**Rule:** if it's clickable and text-only-sized (a button, a filter chip, a
badge), make it a pill. If it's a content container (card, panel, image
frame), use the 6–14px range. Large marketing panels can go up to ~24–28px.
Nothing in the system uses 0 radius except utility/reset elements.

## 5. Elevation & Background Treatment

This is the site's most distinctive pattern — reproduce it as a named
"glow" treatment rather than ad hoc per section:

1. **Base image/color layer** — often `filter: brightness(70%)` if a photo.
2. **Noise/grain overlay** — a small tiled webp (≈150–250px tile), repeated,
   opacity ~0.5, layered with a negative `z-index` just above the base.
3. **Soft glow shape** — an absolutely positioned circle/ellipse
   (`border-radius: 50%`), filled with the body background color or a brand
   gradient, `filter: blur(25–40px)`, oversized (130–200% of its container)
   and positioned off-canvas so only the blurred edge shows.
4. **Backdrop blur pane** — `backdrop-filter: blur(16–35px)` on the
   foreground content surface, so content "floats" above the grain/glow
   rather than sitting flush on it.

Flat, shadow-only cards (`box-shadow: 0 2px 15px rgba(0,0,0,.06)` or a
hairline `0 0 0 1px` ring) are reserved for small UI chrome (dropdowns,
tooltips, form inputs) — **not** for hero or section-level backgrounds.

## 6. Components

- **Buttons:** fully pill-shaped (`border-radius: 45rem`), compact padding
  (`.25rem 1rem` for the base size — buttons are not oversized), solid white
  fill with dark text as the default/primary style, brand purple reserved for
  the highest-intent CTA. Hover states shift background opacity/color, never
  shape or size.
- **Links:** brand `light-1` purple (`#9fa3fc`) on dark backgrounds, no
  underline by default — color alone signals interactivity, consistent with
  the "color is scarce and meaningful" principle.
- **Containers:** a fixed step scale, not arbitrary widths —
  `52rem` (small) / `66rem` (regular) / `76rem` (medium) / `84rem` (large),
  centered with `margin-left/right: auto`. Pick from this scale; don't
  introduce new max-widths.
- **Transitions:** `all .2s` or `all .3s` for simple hover states;
  multi-property transitions (`background-color .2s, border-color .2s`) when
  more than one value changes. Nothing exceeds 0.3s — motion should never be
  the thing a user waits on.

## 7. Standards Checklist (for new UI work)

- [ ] Default to the dark surface (`#121212`); only invert to the light
      surface (`#ebebf4`, not pure white) for a deliberate section break.
- [ ] Derive every text/border/fill color from the white or black opacity
      ramp before reaching for a new hex.
- [ ] Use brand purple only on links and the single highest-priority CTA per
      view — never as a large background fill.
- [ ] Headlines: Outfit, weight 500 (H1–H2) or 400 (H3 and smaller), negative
      letter-spacing scaled to size, line-height 1.2–1.3.
- [ ] Body copy: Outfit regular, line-height 1.5–1.6, never below 14px,
      no letter-spacing adjustment.
- [ ] Buttons and tags: pill radius (`45rem`). Cards/panels: 6–28px radius by
      size. Nothing sharp-cornered except utility elements.
- [ ] Any "hero" or full-bleed section background uses the four-layer glow
      treatment (image/color → grain → blurred glow shape → backdrop blur),
      not a flat gradient or solid fill.
- [ ] Hover/active transitions: single easing, 0.2–0.3s, color/background/
      shadow only — no transform-based motion by default.
- [ ] New container widths must come from the existing scale
      (52/66/76/84rem) rather than a one-off value.
