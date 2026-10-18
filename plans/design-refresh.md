# Plan: Design refresh ("calm & premium")

**Status: proposed (2026-10-19).** A visual pass before demos and the beta. No feature or data changes.

## Context
The app works end to end, but it looks like a template: every page sits in a rounded "window" on a lavender gradient, the only accent is near-black, cards and text are all the same weight, and there's no Offerly identity. The two screens that sell the product, the **interview room** and the **report**, are the plainest.

Direction chosen by the owner: **calm & premium** (think Linear, Notion, Stripe): generous white space, one deep accent colour, crisp type, quiet surfaces, colour used only to mean something. Priority screens: **Welcome, Dashboard, Interview room, Report**.

What helps: colours are already CSS variables in [app/globals.css](../app/globals.css) mapped to Tailwind (`bg-card`, `text-muted`, …), buttons are shared classes (`.btn-*`), and pages use `Card` / `PageTitle` from [components/Shell.tsx](../components/Shell.tsx). Changing the system changes every page at once.

## Design system (phase 1, every page benefits)

**Colour.** Neutral, near-white canvas; one brand accent; semantic colours only for meaning.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF9` (warm off-white, flat, no gradient) | `#0E0F12` | Page |
| `--card` | `#FFFFFF` | `#16181D` | Surfaces |
| `--soft` | `#F4F4F2` | `#1E2027` | Inputs, subtle fills |
| `--line` | `#E7E5E4` | `#2A2D36` | 1px borders (replace most shadows) |
| `--ink` | `#111113` | `#EDEDEF` | Text |
| `--muted` | `#5F6168` (darker than today, AA contrast) | `#9A9DA8` | Secondary text |
| `--accent` | `#3B4BDB` deep indigo (to confirm) | `#7C8BFF` | Primary buttons, links, focus, active nav, key numbers |
| `--accent-soft` | `#EEF0FF` | `#1F2340` | Selected states, highlights |
| `--ok` / `--warn` / `--danger` | `#15803D` / `#B45309` / `#B91C1C` | lighter equivalents | Scores and status only |

**Type.** Keep Geist (already loaded). A clear scale instead of many small greys: Display 44/48 semibold (Welcome), H1 30/36, H2 20/28, body 15/24, small 13/20. Tabular numbers for scores and timers. Tighter letter-spacing on headings.

**Shape and depth.** Radius 12px for cards, 10px for inputs, full pill only for small chips. Borders instead of glass/blur; one soft shadow for floating things (dialogs, the notes button). 8px spacing grid.

**Layout.** Drop the framed window and gradient: full-width canvas, a slim top bar (logo, nav, profile) with a bottom border, content max 1120px. Phones keep the bottom nav. Same structure in the Android WebView.

**Logo.** A simple wordmark ("Offerly" in Geist semibold) with a small mark (e.g. an "O" with a check or a speech tick) in the accent colour, replacing the camera icon. Favicon to match.

**Components.** Restyle in place: `Card`, `PageTitle`, `.btn-primary` (accent fill), `.btn-ghost`, inputs and selects (visible focus ring in accent), tabs/segmented controls, a new `ScoreBadge` / score bar used by dashboard, progress and report.

## Key screens (phase 2)

1. **Welcome.** Big, confident headline, one line of value, primary CTA ("Start free"), and a real product visual (a screenshot or stylised render of the interview room and a report card). Three short "how it works" steps. Trust line (works for any profession; your data stays yours). Mobile-first.
2. **Dashboard.** One clear hero: "Your next step" card with the recommended round and a single primary button. Below, a calm row of four stats with large tabular numbers and small labels; weekly goal as a thin progress bar; mocks left (usage) as a quiet line. Recent reports as a compact list with score badges.
3. **Interview room.** Feels live: interviewer tile with a subtle speaking pulse and name/persona, the current question large and readable, a clear "your turn" state with mic level, a visible timer and question progress, controls in one tidy bar. Transcript in a quiet side panel (collapsible on mobile).
4. **Report.** A scorecard worth sharing: overall score as a ring with verdict colour, per-skill bars, "What went well" and "Fix these 3" in two clear columns, each backed by a short quote from the candidate's answer, and one CTA ("Practise this round again"). Print/share-friendly.

## Out of scope
New features, copy rewrites beyond headings and empty states, Cortex/Notes/Settings redesign (they inherit the new system but get no bespoke work), the native app shell.

## Action items

### Phase 0: approve the look (before code)
1. One static mockup (dashboard + report card) in the new system, light and dark, shared as an artifact for the owner to approve or adjust (accent colour especially).

### Phase 1: system (about 1 day)
2. New tokens in `app/globals.css` (light and dark), type scale, radius/spacing; remove the gradient and glass.
3. `Shell.tsx`: full-width layout and top bar; logo + favicon; `MobileNav` restyle.
4. Restyle `Card`, `PageTitle`, buttons, inputs, tabs; add `ScoreBadge`.
5. Screenshot check of every page (light, dark, 375px phone) for regressions.

### Phase 2: key screens (about 2 days)
6. Welcome. 7. Dashboard. 8. Interview room. 9. Report.

### Phase 3: polish
10. Empty states (no reports yet, no notes), loading skeletons instead of blank screens, focus/keyboard pass, contrast check (WCAG AA).
11. Share preview: page title, description and an Open Graph image for build-score.com.

## Verification
- `npm test`, typecheck, lint and build stay green (visual work, no logic changes).
- Before/after screenshots of the four key screens, light and dark, desktop and 375px, attached to the PR description / shared with the owner.
- One full mock on staging after each phase.

## Open questions (don't block phase 0)
- Accent: deep indigo, or another brand colour?
- Logo mark: wordmark only, or wordmark + symbol?
