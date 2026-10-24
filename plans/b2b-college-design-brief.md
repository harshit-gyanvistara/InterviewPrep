# Design brief: B2B for colleges

For the designer. This covers the new flow only — a college's placement cell sets up its structure, gives students one link, and tracks who's on track. Everything here is built and working end-to-end; nothing has been designed yet, so it's currently using plain default styling.

## The one thing to get right

**This should not read as an admin dashboard.** No grid of stat tiles, no sidebar-plus-table-plus-filters SaaS-admin layout, no "cards full of numbers" homepage. The product this sits inside (micro1.ai-style, see `DESIGN_GUIDELINES.md` in this repo) is dark, editorial, confident — closer to a premium consumer product than an enterprise admin panel. A placement-cell coordinator and a student should both feel like they're using the same app, not like the coordinator got dropped into a different, colder tool.

Concretely, avoid:
- KPI tiles in a 4-up grid at the top of a page
- Left nav + top nav + breadcrumbs stacked together
- Dense data tables as the primary surface for anything a human reads daily
- Red/green/amber status dots used as the main visual language

Prefer:
- One clear focal thing per screen (today's plan, the one decision to make, the one list that matters right now)
- Progress expressed as narrative/visual (a path, a stage sequence, a single sentence) rather than a KPI number
- The existing glow/grain/pill/opacity-ramp language from `DESIGN_GUIDELINES.md` carried through, not abandoned for "admin mode"

## Who uses this

1. **Student** — already using the app solo. Now also belongs to a college org. Needs: see what's required of them (the "floor") vs their own free practice, in one place, without it feeling like homework tracking.
2. **Placement-cell coordinator / faculty admin** — sets up the college once, then checks in periodically. Not a daily power user. Needs: confidence the setup is right, and a fast read on who needs attention — not a full BI tool.
3. **Super-admin (us)** — creates orgs, applies starter kits. Low-frequency, fine to be plainer/functional.

## Screens and flows to design

### 1. Student: joining a college org
- Student gets one link (join code or invite). Short form — pre-filled where the invite already knows the answer (e.g. section), asking only for what's missing (target role, resume).
- Should feel like finishing onboarding, not filling out an admissions form. 2 steps max once an org membership is detected.

### 2. Student: "Your plan" (new card on the home/dashboard)
- Sits ahead of today's recommendations. Shows the student's trajectory: ordered stages (mandatory vs optional, due dates), which are done, which is next, locked ones greyed.
- This is the single most important new screen. It needs a visual metaphor that isn't a progress bar with percentages — think a path, a sequence of waypoints, a story — something that matches the brand's "quiet motion, soft geometry" principles rather than a project-management Gantt feel.
- A mandatory ("floor") stage and free practice coexist on the same page without the floor looking like punishment and free practice looking like an afterthought.

### 3. Student: practising for an org vs practising as me
- A switcher (`PractisingFor.tsx`) that controls whether a session is shared with the org. Needs to clearly communicate "this one counts toward my college's plan" vs "this is just for me," as a lightweight toggle, not a settings page.

### 4. Coordinator: org setup ("Set up your college" checklist)
- One-time flow after an org is created: apply a starter kit (rounds, trajectories, section structure), or build from scratch.
- Should read like a short guided setup (a handful of steps, one at a time), not a settings dashboard with every field exposed at once.

### 5. Coordinator: sections and groups
- Manage a department/year/section tree, plus ad-hoc groups (e.g. "Amazon drive shortlist"). Add/rename/archive, move a student between sections.
- Needs a tree UI that doesn't feel like a file explorer — this is the one place some structure/hierarchy visualization is unavoidable, but keep it light (expand/collapse, not nested boxes-in-boxes).

### 6. Coordinator: mock library
- Clone a built-in round or create one from scratch for the org (title, company, role, duration, topics, rubric). This is closer to a content/editor screen than a dashboard screen — treat it like editing a document, not configuring a form with 12 fields visible at once.

### 7. Coordinator: trajectories (the plan builder)
- Build the ordered stage sequence (pack, target count, due date, optional score gate, mandatory/optional) and assign it to a section or group. This is the admin-side mirror of screen #2 — strongly suggest reusing the same visual "path" language so a coordinator builds the same thing a student later sees.

### 8. Coordinator: overview / who needs attention
- This is the one screen most tempted to become a dashboard. Resist a stat-tile grid. Instead: a short, prioritized list — "3 students haven't started," "this section is behind," "these 2 skills are weak across the batch" — written more like a briefing than a BI report. Numbers support sentences; they don't replace them. Respects a minimum share level — members below it don't appear, so the screen should degrade gracefully when data is sparse (small colleges, early days) rather than showing empty charts.
- One-click nudge for selected students should feel like sending a quick note, not triggering a bulk-email campaign.

### 9. Coordinator: bulk invite via CSV
- Upload or paste a CSV with sections; get back a list of links. Mostly functional — fine to be simple, but keep the same type/spacing/button language as the rest of the app so it doesn't feel bolted on.

### 10. Student: reminder emails
- "Stage due in 2 days" / "not started" emails. Should match the product's tone (quiet, direct) rather than generic transactional-email templates — worth a simple branded email layout, not a bare HTML table.

## Existing design language to build from

See `DESIGN_GUIDELINES.md` at the repo root — the full system (dark-first, opacity-ramp hierarchy, one accent purple, pill buttons, glow/grain backgrounds, Outfit typeface, soft-but-not-fully-round card radii). Everything above should extend that system, not introduce a parallel "admin theme." If a screen genuinely needs a density or structure the current system doesn't have an answer for (e.g. the section tree, the trajectory builder), design it as a deliberate extension of the existing language rather than reaching for generic admin-dashboard conventions (Material-style data tables, card grids, sidebar nav) by default.

## What's explicitly out of scope for this pass

Billing, SSO, LMS integration, an admin UI for editing starter kits. Don't design for these.
