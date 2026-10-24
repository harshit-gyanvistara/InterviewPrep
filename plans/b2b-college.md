# Plan: B2B for colleges (sections, mock templates, trajectories, org context)

**Status: built (2026-10-24), B.1 to B.10. Seven migrations are written and checked against a local Postgres but not applied to Supabase; nothing has been run in a browser.** Builds on [plans/m2-org.md](m2-org.md) (orgs, cohorts, assignments, share levels: all built). Solo use must keep working unchanged.

## Goal
A college's placement cell sets up its structure once (departments, years, sections), starts from ready-made mock templates, gives students one link, and sees who is on track. Each student gets a plan with a college-required part (the floor) and their own practice (the free zone).

## What exists vs what is new
| Exists (verified in code) | New |
|---|---|
| Orgs, roles, invites, join codes locked to email domains, seats | Org-first student onboarding (pre-filled, short) |
| Flat cohorts; a member has one `cohort_id` | Sections: a cohort tree (Department / Year / Section), plus optional ad-hoc groups |
| Assignment = one **built-in** pack + target count + due date | Org mock library (clone and edit rounds) and trajectories with score gates |
| Org setting `allowedPackIds` | Starter kit applied when a college is onboarded |
| Share level per member; analytics hide scores below 3 sharers | Minimum share level; sharing of free practice becomes opt-in |
| Server-stamped `org_id` / `assignment_id`; `pack_snapshot` and `rubric_version` frozen per session | Org and cohort context reaching the interviewer and scorer |
| `recommendPack` (weakest skill) | Remedial stages |
| Invite links, CSV paste; auth emails only (Resend via Supabase) | CSV with sections, reminders (no scheduler or app email sender today) |

## Decisions (defaults so work isn't blocked; change any)
| # | Question | Default | Why |
|---|---|---|---|
| B1 | Does passing a gate skip a mandatory stage? | No. Passing completes it. Only remedial stages can be skipped. A waiver is a separate coach action with a reason, audited | One lucky score must not bypass a requirement |
| B2 | Is personal practice locked until the floor is met? | No. Always open | Locking pushes struggling students away |
| B3 | Do floor scores need to be visible to the org? | Yes. Org sets a minimum share level (default `scores`) for floor sessions. Free practice is shared only if the student opts in | Dashboards otherwise have holes |
| B4 | Can scores drive shortlisting? | A signal only, stated to students at join. No auto-reject | Scorer calibration is thin (9 seed cases) |
| B5 | Who sets the standard rubric? | Platform default, optional per-org override | Fair ranking inside a batch |
| B6 | Reminder channel | Email first, in-app second | Email is already paid for |
| B7 | How are sections modelled? | A cohort **tree** via `cohorts.parent_id`; a student sits in one leaf (their section). Assigning to a node covers all its descendants. Ad-hoc, overlapping groups (e.g. "Amazon drive shortlist") use a separate many-to-many `groups` table | Keeps the single `cohort_id` the code relies on; groups cover overlap without rewriting every check |
| B8 | Templates: copy or link? | **Copy.** Applying a kit copies rounds, trajectories and settings into the org, recording kit id and version | A college's edits must never change another college's setup |
| B9 | Where do kits live? | In code (`lib/starterKits.ts`), versioned, like `lib/domains` and `lib/packs` today. No admin UI for kits at first | Fastest; matches existing pattern |

## Slices (each ships alone, tested, in this order)

### B.1 Org-first onboarding (≈ 3 days), built in three blocks
- **B.1a data layer: built (2026-10-24), migration not yet applied.** `settings.studentFields` (up to 6: key, label, required), `invites.attributes` and `memberships.attributes`, `join_org` takes `p_attributes` (invite values win), `lib/memberAttributes.ts` (merge and required-field rules), join and invite APIs accept and validate details. No `lockedFields` setting: a value the invite carries is locked by definition. Tests added; the SQL function is untested until the migration runs against a database.
- **B.1b screens: next.** Join page asks for the unfilled fields; Invites tab can pre-fill them; admin settings edit `studentFields`; `MyOrgSummary` exposes the member's details.
- **B.1c onboarding: after that.** Compact flow for members of an org.
- Org settings gain `studentFields` (college, branch, year, program). Section names can supply branch and year (B.2).
- Joining stores these on the member (new `memberships.attributes jsonb`), not in the user's profile.
- Order today is sign-in, then `/join` completes (and clears `pendingJoin`), then `/onboarding` (`lib/pages.ts:30`). So onboarding detects an active org membership (`useMyOrgs`), not `pendingJoin`. With one, it drops to 2 steps (target role, resume). Device check stays optional.
- Files: `lib/orgSettings.ts`, `app/join/[token]/page.tsx`, `app/onboarding/page.tsx`, migration for `memberships.attributes`.
- Tests: join then onboard shows 2 steps and no redundant fields; solo onboarding unchanged.

### B.2 Sections and groups (≈ 4 days)
- `cohorts.parent_id` (nullable, same org, no cycles, max depth 3). A `cohortScope(cohortId)` helper returns the node and its descendants; use it everywhere a single `cohort_id` is compared: `orgCohorts.ts` (assignment audience at lines ~144 and ~205), `orgPractice.ts:69` (`checkAssignment`), coach scoping in `orgDashboard.ts`, `orgAnalytics.ts` grouping (roll-ups per level).
- Admin UI: Cohorts tab becomes a tree (add child, rename, archive, move member to a section). Archiving a node with members is blocked until they are moved.
- Groups: `groups` + `group_members` (many-to-many). Assignments can target a cohort node or a group.
- Files: new `lib/orgSections.ts`, `lib/orgCohorts.ts`, `components/org/Cohorts.tsx`, migration (RLS like `cohorts`).
- Tests: descendant scoping for assignments, coach and analytics; cycle and depth rejected; a member in a group sees that group's assignment; existing flat-cohort org behaves as before.

### B.3 Bulk invite with sections (≈ 2 days)
- CSV columns: email, section path (`CSE / 2027 / A`), optional attributes. Missing sections are created. One email invite per row; the list of links is returned to copy or download.
- Files: `lib/orgInvites.ts`, `app/api/orgs/[slug]/invites/bulk/route.ts`, Invites tab.
- Tests: duplicates, bad emails, seat limit exceeded (reject the whole file with the count), coach limited to own section.

### B.4 Minimum share level and opt-in sharing (≈ 2 days)
- Org setting `minShareLevel`. `join_org` rejects a lower choice; Settings → Organisations blocks lowering below it.
- **Behaviour change.** Today every session is org-stamped, and so visible to the org, whenever the "Practising for" switcher is set to it, assigned or not (`app/practice/page.tsx:58`, `lib/interviewContext.ts:66`). Change: sessions are stamped only from an assignment or trajectory stage (floor). The switcher becomes an explicit "also share this practice with <org>" opt-in, off by default.
- Files: `lib/orgSettings.ts`, `lib/orgMembership.ts`, `lib/interviewContext.ts`, `components/PractisingFor.tsx`, `app/practice/page.tsx`, join page, migration for `join_org`.
- Tests: join below minimum fails; a switcher-off practice never appears in org analytics; an assigned mock always does; existing org-practice tests updated.

### B.5 Org mock library (≈ 1 week)
- New `org_packs` table (org_id, the same fields as `Pack`, source tag `cloned-from`). Admins clone a built-in round, edit title, company, role, duration, topics, rubric, style, or create from scratch.
- Wire-through (all currently built-in or user-only): `createAssignment` (`orgCohorts.ts:170`) accepts org packs; `resolvePack` (`interviewContext.ts:100`) resolves an org pack for active members; `checkOrgPractice` always allows the org's own packs; `/practice` lists them for members under the org name.
- Org packs are frozen in `pack_snapshot` like any pack, so later edits don't change old reports.
- Files: new `lib/orgPacks.ts`, `app/api/orgs/[slug]/packs/**`, `components/org/Packs.tsx`, `lib/interviewContext.ts`, `lib/orgCohorts.ts`, `lib/orgPractice.ts`, `lib/db.ts` (`useAllPacks`), migration.
- Tests: member of another org cannot resolve it; non-member cannot; edit after a session leaves that session's snapshot intact; validation reuses `isValidPack`.

### B.6 Trajectories (≈ 1.5 weeks)
- Tables: `trajectories` (org, name), `trajectory_stages` (position, pack_id built-in or org pack, target_count, due_at, `gate_score` nullable, mandatory), `trajectory_assignments` (to a cohort node or group). Stage progress is **derived** from `reports`, not a new write path: done when enough reports on that pack for that assignment reach the gate (`Report.overall`, "Too short" never counts).
- Each stage creates or links one `assignment`, so stamping, completion counts and `myAssignments` keep working.
- Student "Your plan" card on the dashboard ahead of recommendations: stages in order, mandatory vs optional tags, due dates.
- Files: new `lib/orgTrajectories.ts`, `app/api/orgs/[slug]/trajectories/**`, `components/org/Trajectories.tsx`, `app/page.tsx`, migration.
- Tests: gate logic, ordering, scoping to sections and groups. Exit: Playwright run where a student completes stage 1 below then above the gate and stage 2 unlocks.

### B.7 Starter kit for a new college (≈ 3 days)
- `lib/starterKits.ts` (B9): a kit = org settings defaults (allowed rounds, `minShareLevel`, share default, context placeholders) + a set of org packs (cloned from the catalog) + trajectory templates + a suggested section structure. First kit: "College placement" with e.g. aptitude/behavioural/technical/HR rounds and two trajectories (8-week campus placement, 2-week crash plan).
- Applied (B8, copy) in two places: the super-admin create-org form (pick a kit by org kind) and an owner "Set up your college" checklist on `/org/[slug]` for orgs created without one. Records `settings.kit = { id, version }`; re-applying is blocked (no overwrites).
- Files: new `lib/starterKits.ts`, `lib/orgAdmin.ts`, `app/admin/orgs/page.tsx`, `components/org/Setup.tsx`.
- Tests: applying creates independent copies (editing the org's copy doesn't touch the kit or another org); idempotent; audited.

### B.8 Org and cohort context into the interview (≈ 1 week)
- Org settings gain `context` (target companies/roles, tone, notes); sections gain `context` (JD, tech stack). Merge order: platform default, org, section (leaf wins), student profile.
- Merged on the server in `loadInterview` on the first call, frozen on the session (extend `pack_snapshot` with `orgContext`), sent to liveAgent as an optional `orgContext` on `TurnRequest` / `ReportRequest` (unknown fields are ignored today, so older agents don't break), used in `prompts.py`. An optional org rubric replaces `pack.rubric` before freezing, so `rubric_version` changes by itself.
- Files: `lib/interviewContext.ts`, `lib/schemas.ts`, `liveAgent/live_agent/models.py`, `prompts.py`, `npm run agent:types`.
- Tests: snapshot frozen, solo sessions send no `orgContext`. Re-run `npm run agent:eval` against the baseline and `npm run agent:measure` for token cost before merging.

### B.9 Adaptive stages and waivers (≈ 1 week)
- Below a gate: insert a remedial stage from `recommendPack`'s weakest skill, once per stage, capped at 2. Quick Mock doesn't carry `assignmentId` today (`components/QuickMock.tsx`), so remedial stages use short org or built-in packs, or Quick Mock is extended to pass it.
- Coach waiver on a stage with a required reason, written to `audit_logs`.
- Files: `lib/orgTrajectories.ts`, `lib/recommend.ts`, member detail page.

### B.10 Reminders and exception views (≈ 1.5 weeks)
- A scheduler (Vercel cron or Supabase `pg_cron`; decide at deploy) calls a protected route daily; sends "stage due in 2 days" and "not started" emails through a new sender (Resend API).
- Admin overview adds at-risk (average below a threshold, only among members sharing scores), unstarted mandatory stage, and batch-wide weak skills, per section. All respect the 3-sharer minimum.
- One-click nudge for selected students (rate-limited, audited).
- Files: new `lib/notify.ts`, `app/api/cron/reminders/route.ts`, `components/org/Overview.tsx`.
- Tests: no email to people who left; at most one nudge per student per day; at-risk list hides members below the share level.

## Out of scope here
Billing, SSO, LMS, guardian-consent flow (stub stays), an admin UI for editing kits, company-drive packs beyond what B.5 lets admins author.

## Risks
- **Scoring trust** gates real outcomes. No hard gates for an org until B.6 has run on real sessions and `agent:eval` is re-baselined.
- **B.2 touches many scoping checks.** Missing one leaks an assignment or a coach's view; list them from the grep above and test each.
- **Prompt growth:** org context adds tokens to every turn; measure after B.8.
- **Derived completion:** editing a gate later can change history. Decide before B.6 ships whether to store the gate at completion.

## Open questions for the owner
1. Who is the daily admin: placement cell, faculty, or a training partner?
2. Will all students have college emails? (domain-locked codes vs CSV invites)
3. How deep are real sections: Department / Year / Section, or do some colleges also need Campus or Programme? (the tree allows 3 levels by default)
4. What should the first kit contain, and who writes the rubrics?

## As built (2026-10-24)

Every slice is in. Typecheck, lint and `next build` pass; 515 TypeScript and 117 Python tests pass. The seven migrations (`20261024120000` to `20261024180000`) ran in order against a throwaway Postgres 14 with a Supabase stub, and `join_org` and the new constraints were exercised there. They have not been applied to your Supabase project, and no screen has been opened in a browser (accounts and orgs need a Supabase project, which this machine doesn't have configured).

Where it differs from the plan above:

| Slice | Difference |
|---|---|
| B.1 | No `lockedFields` setting: a value an invite carries is locked by definition. Admin text for fields keeps an existing field's key when its label is unchanged, so saved answers stay attached. |
| B.2 | Archiving a section with members is **not** blocked (it was before, and the UI already handles it). Groups can be assigned work but have no analytics roll-up. |
| B.3 | The seat check counts active members plus waiting email invites plus the file, and refuses the whole file. |
| B.4 | The plan said free practice was shared by default. It isn't: "Practising as me" is the default and private, and only practice done for an org (the switcher, or an assignment) is visible to it. So B.4 became the minimum share level plus clearer wording on the switcher. |
| B.5 | Org rounds are stored as a Pack in `org_packs`; titles and list items can't be blank. Members see the org's rounds only when practising for that org. |
| B.6 | Stage order is shown (locked stages are greyed) but not enforced server-side: a student can still practise a later stage by URL, and it counts. Each stage copies its gate onto its assignment, so editing a plan never rewrites history. |
| B.7 | Applying a kit rolls back what it added if a step fails. |
| B.8 | No org rubric override: an org's own rounds already carry their rubric. Context is frozen on the session at the first AI call. `agent:eval` was **not** re-run (it calls real Gemini); with no context the prompts are byte-identical, which the Python fixtures confirm. |
| B.9 | "Remedial stages" became a computed suggestion on the student's plan (after two tries below the score, it points at the round for their weakest skill) rather than stages written to the database. Waivers are separate rows and never touch reports. |
| B.10 | A reminder endpoint (`/api/cron/reminders`, secret-protected) exists, but **no scheduler is wired**: that depends on where you deploy. Mail goes through Resend's API and sends nothing until `RESEND_API_KEY` and `MAIL_FROM` are set. |

## Still open

- Apply the migrations, then run `supabase/tests` against a real project.
- Set `CRON_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, and schedule a daily call to `/api/cron/reminders`.
- Try each screen in a browser with a real org (nothing here has been seen rendered).
- Decide whether gates should be enforced in order on the server.
- Re-run `npm run agent:eval` and `npm run agent:measure` once org context is in real use.
