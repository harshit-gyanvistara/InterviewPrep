# Plan: M2-Org (organisations: dashboard, invites, assignments, analytics)

**Status: planned (2026-10-19), not started.** Builds on [plans/org-ready-schema.md](org-ready-schema.md) (M2.10: tables, RLS, `lib/authz.ts`), which is applied on Supabase. Overall design and privacy rules: [plans/organisations.md](organisations.md). Milestone tasks O.1–O.7 in [implementationPlan.md](../implementationPlan.md).

## Goal
A college, company or institute can give Offerly to its people. Admins invite members and see their practice (within what each member chose to share), and coaches set assignments. Solo use keeps working exactly as today.

## How it fits together
```
Marketing (super-admin page) ─ creates org, sets plan rows (entitlements)
        │
Org admin (/org/<slug>) ─ invites ─► Member opens link ─► signs in (same login) ─► consent screen ─► member
        │                                                                                         │
        ├─ cohorts, assignments ◄──────────────────────────── "Practising for <org>" switcher ◄──┘
        │                                                       │
        └─ analytics / member detail / CSV ◄── reports and sessions stamped with org_id by the server
                   (every member view and export written to audit_logs)
```

## Decisions (defaults chosen so work isn't blocked; change any of them)
| # | Question | Default | Why |
|---|---|---|---|
| G1 | How do invites reach people before SMTP is set up? | Admin copies an invite link or join code and shares it themselves; emailed invites switch on once SMTP is set up (already pending for sign-in) | No dependency on email setup |
| G2 | Who can use the super-admin page? | Emails listed in `SUPER_ADMIN_EMAILS` (env), e.g. the marketing team | Simple, no new role system |
| G3 | Which limits apply when practising for an org? | The org's `entitlements` only; solo practice uses the member's own package | Clear for both sides; marketing sets org plans |
| G4 | Can a member see an org's other members? | No. Only admins and coaches, via the dashboard | Privacy for students |
| G5 | A member leaving | They can leave any time (Settings → Organisations); their history stays theirs, and the org loses access from that moment | D11 |
| G6 | Member data shared by default | Consent screen preselects the org's `defaultShareLevel` ("scores" unless the org changes it); the member can pick another | D11 |

## Slices (each one ships on its own, tested, in this order)

### O.1 Super-admin: create orgs and set plans (≈ 2 days): **built (2026-10-19)**
Built as planned: `/admin/orgs` (list and create) and `/admin/orgs/[id]` (plan editor, details, settings, people, owners, audit log), `/api/admin/orgs[/...]`, `lib/orgAdmin.ts`, `requireSuperAdmin()`. An owner with no account gets an email-bound owner invite link; it works once O.2 ships `/join`.

- `/admin/orgs` page, plus `/api/admin/orgs` routes, allowed only for `SUPER_ADMIN_EMAILS` (`requireSuperAdmin()` in `lib/authz.ts`).
- Create an org (name, slug, kind), name its first owner by email (an owner invite), and edit `entitlements` (seats, mocks per period, any key) and `settings` with plain form fields, so marketing never needs SQL.
- Every change is written to `audit_logs`.
- Tests: non-super-admin gets 403; entitlement edits validated (key, limit ≥ 0 or unlimited, period).

### O.2 Invites, join codes, seats (≈ 3 days): **built (2026-10-19)**
Built and tested end to end on Supabase (2026-10-19): `join_org` database function (migration `20261019170000_join_org.sql`, applied), `lib/orgInvites.ts`, `/api/orgs/[slug]`, `/api/orgs/[slug]/invites[/id]`, `/api/join/[token]`, the `/join/[token]` page (including the share-level choice from O.3) and `/org/[slug]` with the invite manager. Deviations: routes use the org slug, not the id; a missing `seats` entitlement means no seat limit; an invite opened while signed out is kept in the browser (`offerly.pendingJoin`) and resumed after sign-in, before onboarding. Still to do in O.3: Settings → Organisations (change share level, leave).

- `/api/orgs/[orgId]/invites`: create an email invite or a reusable join code (role, cohort, expiry, max uses), list and revoke them. Needs `members.manage`.
- Tokens are 32 random bytes shown once. Only the SHA-256 hash is stored (`invites.token_hash`). Links look like `/join/<token>`, and a join code is a short readable code mapped the same way.
- `/join/[token]`: sign in if needed (same login), see the org name, then the consent screen (O.3), then join.
- **Seat limit:** joining checks active memberships against the `seats` entitlement in one database function (`join_org`), so two people can't take the last seat at the same time. Over the limit → "This organisation has no free seats; ask your admin."
- `email`-bound invites only work for that email. `allowedEmailDomains` (org settings) can restrict join codes to e.g. `@college.edu`.
- CSV upload: a list of emails → one invite link each, shown as a list to copy or download (G1).
- Tests: expired, used-up and revoked invites; wrong email; domain rule; seat race; a member can't invite.

### O.3 Consent on join (≈ 1 day): **built (2026-10-19)**
Built: the consent screen shipped with O.2; now Settings → Organisations (`components/OrgsSettings.tsx`), `/api/me/orgs`, and `PATCH`/`DELETE /api/orgs/[slug]/me` (`lib/orgMembership.ts`). The last owner can't leave (409); they make someone else an owner first.

- Consent screen: what the org will see at each level (activity / scores / full), with the org's default preselected (G6). Writes an `org_share` consent row with a version.
- Settings → Organisations: see your orgs, change your share level (new consent row; the old one revoked), and leave the org (G5).
- Tests: the share level change is visible to `canViewMember()` straight away; leaving revokes access.

### O.4 Practising for an org: switcher, stamping, quotas (≈ 3 days) (O.5 + O.7): **built (2026-10-19)**
Built: `components/PractisingFor.tsx` (top bar and /practice), `settings.practisingFor`, `config.orgId` on new sessions, `lib/orgPractice.ts` (`checkOrgPractice`), stamping in `lib/interviewContext.ts`, report stamping in `lib/userData.ts`, `requireOrgAllowance` / `checkOrgEntitlement` and `usage_total_org` (migration `20261019180000_org_usage.sql`). Deviations: the org is checked and stamped only on a session's first AI call, so a session never moves between orgs; a missing `mocks` entitlement means no org limit; the per-user `ai_calls` limit still applies to org practice (abuse guard), only `mocks` uses the org plan; Quick Mocks skip `allowedPackIds` (they're built from rounds /practice already filtered). Org-authored packs in /practice wait for an authoring UI.

- **Switcher** in the top bar (`components/Shell.tsx`): "Practising as: Me / <Org name>". Stored per user in settings, and only shown to people with an org.
- **Stamping:** a new session records the chosen org in its config. The turn route (server) verifies `can(user, "practice", orgId)` and the org's `allowedPackIds`, then writes `sessions.org_id` (and `assignment_id`): server-owned columns, like the versions from M2.3. Saving a report copies `org_id`/`assignment_id` from its session on the server (`/api/db/reports` PUT), so the browser never sets them.
- **Quotas (G3):** `requireAllowance` gets the org context. Org practice checks the org's `entitlements` by summing `usage_ledger` where `org_id` matches (new `usage_total_org` function); solo practice is unchanged. Use is recorded with `org_id`.
- **Org packs:** `custom_packs` with `org_id` appear in `/practice` for members of that org.
- Tests: a non-member can't stamp an org; a disallowed pack gives 403; the org quota gives 429; solo is unaffected; a member removed mid-way can't start new org sessions.

### O.5 Cohorts and assignments (≈ 2 days): **built (2026-10-19)**
Built: `lib/orgCohorts.ts`, routes under `/api/orgs/[slug]/{cohorts,members,assignments}` and `/api/me/assignments`, `/org/[slug]` tabs (Invites, Cohorts & members, Assignments), the member's "Assigned to you" on the org page, assignments first in the dashboard's next step, and `/practice?pack=…&assignment=…`. The server checks the assignment (same org, the member's cohort or everyone, the assigned round) and stamps `sessions.assignment_id` with the org; reports copy it. Progress counts reports per assignment. Deviations: assignments use built-in rounds only (org rounds need their authoring UI); a coach placed in a cohort sets work for that cohort only, a coach with no cohort for any; role changes and removing members wait for O.6.

- Admin: create and archive cohorts, and move members between them (`cohorts.manage`).
- Coach/admin: create an assignment (pack, cohort or everyone, due date, target mock count) (`assignments.create`).
- Member: "Assigned to you" first on the dashboard (`recommendPack` prefers open assignments), with progress (2 of 3 done) and the due date. Starting from an assignment stamps `assignment_id`.
- Coaches see only their own cohorts' assignments and analytics: `can()` gains an optional cohort scope (`memberships.cohort_id`).

### O.6 Admin dashboard: members, analytics, member detail, export (≈ 4 days): **built (2026-10-19)**
Built: `lib/orgAnalytics.ts` (pure, share-level cuts), `lib/orgDashboard.ts`, `/api/orgs/[slug]/{dashboard,export,audit}`, `GET/PATCH/DELETE /api/orgs/[slug]/members/[userId]`, `/org/[slug]` tabs Overview · Members · Analytics · Invites · Cohorts · Assignments · Audit log (each only for roles that can use it), and `/org/[slug]/members/[userId]`. Only org-stamped practice is ever read. Choices: groups need at least 3 members sharing scores before any score shows (counts always show); too-short mocks count as activity but not in averages; a coach placed in a cohort sees only that cohort, a coach with none sees the whole org; you can't change your own role or remove yourself (leave from Settings); CSV cells are quoted and formula-safe.

`app/org/[slug]/` (read `node_modules/next/dist/docs/01-app/02-guides/multi-tenant.md` first). Tabs:
- **Overview:** active members against seats, mocks this period against the quota, assignment completion, members who haven't practised in 7 days.
- **Members:** list with role, cohort, status, last practice and mock count, plus scores where the member shares them. Invite, change role, remove.
- **Analytics:** by cohort: mocks completed, average overall, weakest skills, readiness, filler rate. Computed on the server from `sessions`/`reports` rows with this `org_id`. Each member's numbers are included only at the level `canViewMember()` allows, and too-short reports are skipped (`isScored`).
- **Member detail:** progress and reports at the member's share level; transcripts only at "full". Every open writes `audit_logs` (`member.viewed`).
- **CSV export:** members × mocks × scores at each member's share level; written to `audit_logs` (`org.exported`).
- **Audit log:** the org's own log, for owners and admins.
- All reads go through server routes with the secret key after `can()`; RLS never opens member data (M2.10 decision).

### O.7 End-to-end and exit gate (≈ 2 days): **passing locally (2026-10-19)**: 9 end-to-end tests and 22 database tests green against a local Supabase; CI not yet run (nothing pushed)
Written: Playwright (`playwright.config.ts`, `e2e/org.spec.ts`, `e2e/helpers.ts`, `e2e/stub-agent.mjs`), `npm run e2e`, and a CI step in the `database` job. The app is built into `.next-e2e` and run on :3300 against a local Supabase only (the config refuses any other URL), with a stub liveAgent on :8100. Users are created with the admin API and signed in through the app's own `/api/auth/verify` with a one-time code from `generateLink`. Covers the full flow plus the five exit-gate checks; `supabase/tests/org-rls.test.ts` covers isolation in the database itself. Needs Docker to run locally.

Playwright: super-admin creates org → owner invites → member joins with a code and picks "scores" → member completes an assigned mock (Gemini mocked) → admin analytics shows it, without the transcript → CSV export matches.
Isolation tests: org A vs. org B, share levels, removed members, seat limit, quota 429 (the organisations.md exit gate).

## Not in M2-Org (later)
Emailed invites (with SMTP), Google Workspace / Microsoft domain sign-in (D14), an org pack authoring UI, self-serve org billing (M6), white-label, SAML/SCIM, LMS integrations, screening mode.

## Risks
- **Leaking member data through analytics.** The share check runs per member in one function (`canViewMember`), and tests cover each level. Aggregates for a cohort below 3 members show counts only.
- **Seat races.** Handled by the single `join_org` database function.
- **Report rows without org_id** (made before O.4) are simply not org data; nothing is backfilled.
- **Size:** about 17 working days for one engineer. Slices O.1–O.3 already give a usable "invite and join" flow.
