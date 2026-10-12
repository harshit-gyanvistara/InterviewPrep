# Plan: Organisations (multi-user workspaces) for Offerly

## Context
Today Offerly is single-user and browser-local ([lib/db.ts](../lib/db.ts) → `localStorage`, no auth). We want any organisation (college, company, coaching institute, bootcamp; the long-term goal is "for all") to buy Offerly for many users. For now an org uses it **for learning and mock practice only**. Employer screening of applicants is out of scope here and needs its own product decision.

Owner decision: **org support is pulled into M2**, so tenancy goes in when accounts and Postgres land and doesn't have to be retrofitted later. See [implementationPlan.md](../implementationPlan.md) M2 and M2-Org.

## Verdict
**Yes, and M2 is the right time.** All data already goes through one seam (`Collection<T>` in [lib/db.ts](../lib/db.ts)), and M2 already adds `users`, `user_id` on every row, auth and server-trusted context. Orgs add an `org_id` dimension, roles and an admin view on top of that. The main risks are **privacy** (what an org may see about a member) and **quota/cost control** (an org of 500 users can burn through the Gemini budget fast). The technology itself is low-risk.

## Core design decisions (become ADRs)
| ID | Decision | Recommendation |
|---|---|---|
| D10 | Tenancy model | Shared DB with an `org_id` column, one deployment, path-based `/org/[slug]`. No per-org database or subdomains yet (white-label comes later). |
| D11 | Who owns data | **The user owns their data.** An org sees only what the member agrees to share when joining: activity and scores by default, transcripts and resume only if the member opts in. Leaving an org revokes its access. Deleting an org never deletes members' personal data. |
| D12 | Individuals vs. orgs | Users can exist with no org (B2C stays). A user can belong to several orgs. Each session records which org, if any, it was practised under. |
| D13 | Org billing in M2 | We (super-admin) set `entitlements` rows (seats, mocks per month) by hand and invoice offline. Self-serve org checkout moves to M6 and writes the same rows. |
| D14 | Org SSO | Google Workspace / Microsoft sign-in through the M2 auth library, restricted by email domain. Add SAML/SCIM (e.g. WorkOS) only when a customer requires it. |

## Designed to expand
Open business questions (pricing, minors, data residency, screening mode) are **decided later**. The design must let us answer each one by adding config or rows, not by changing the schema or rewriting routes. Rules:

1. **Check capabilities, never names.** Code asks `can(user, "assignments.create", orgId)` or `checkEntitlement(orgId, "mocks")`. It never checks `role === "admin"` or `plan === "pro"` directly.
2. **One function per decision.** Each policy lives in a single function with today's simple answer. A later decision changes that function, not its callers.
3. **Generic tables over specific columns.** Limits, consents and usage are rows with a `key`, so a new kind needs no migration.
4. **Strings over enums** for things that will grow (org kind, role, meter, consent kind). Validate them with Zod in code, so new values ship without a migration.
5. **Per-org settings and feature flags** in `organizations.settings` JSONB, read through one typed helper with defaults (same pattern as `DEFAULT_SETTINGS` in [lib/types.ts](../lib/types.ts)).

| Decision we will make later | What we build now | How it expands |
|---|---|---|
| Pricing (per seat, per mock, minutes pool) | `entitlements` rows (`seats`, `mocks`) and a generic `usage_ledger.meter`; `checkEntitlement()` | Add rows or meters (e.g. `voice_minutes`); billing in M6 maps a price to entitlements |
| Custom roles | Code map `ROLE_PERMISSIONS` in `lib/permissions.ts`; `can()` | Move the map to a `roles` table per org; callers unchanged |
| Minors / guardian consent | `consents` table with versioned kinds; nullable `users.birth_year`; `requiresGuardianConsent()` returns `false` | Turn the policy on, add a `guardian` consent kind and a guardian flow |
| Data residency | `organizations.data_region` (one value today); all DB access through `getDb(region)` | Add a regional database and route by region |
| SSO / SAML | Auth providers configured per org in settings | Add providers (Google, Microsoft, then SAML) without touching org code |
| Employer screening mode | `organizations.settings.features` flags; purpose stored on each session | Ship screening behind a flag with its own consent kind and report view |
| New org types (school, bootcamp, company) | `kind` is free text, used only for defaults and analytics labels | New kinds are just new values |
| Integrations (LMS, HR tools) | `audit_logs` doubles as an event log of org actions | Add webhooks or exports that read the event log |

## Data model (adds to the M2.2 schema)
- `organizations`: id, name, slug, kind (text: `college`, `company`, `institute`, …), data_region (default `"default"`), settings JSONB (allowed pack ids, default persona/duration, default share level, allowed email domains, `features` flags), created_at.
- `entitlements`: org_id, key (`seats`, `mocks`, later `voice_minutes`, …), limit, period (`none|month|year`), source (`manual` now, `billing` from M6). Replaces hardcoded seat/quota columns.
- `memberships`: org_id, user_id, role (text, permissions from `ROLE_PERMISSIONS`), status (`invited|active|removed`), cohort_id?, joined_at. Unique on (org_id, user_id). Each active member counts against the `seats` entitlement.
- `consents`: user_id, org_id?, kind (`org_share`, later `guardian`, `ai_training`, …), value JSONB (e.g. `{ shareLevel: "scores" }`), version, granted_at, revoked_at. The member's share level is read from the latest active `org_share` consent, so the consent history is kept.
- `cohorts`: org_id, name (e.g. "CSE 2027", "Sales Q3"), archived.
- `invites`: org_id, email or reusable join code, role, cohort_id?, token_hash, expires_at, max_uses.
- `assignments`: org_id, cohort_id?, pack_id, title, due_at, target_mock_count.
- Packs: `custom_packs` gains a nullable `org_id` for org-authored packs, reusing the `Pack` type in [lib/types.ts](../lib/types.ts).
- `sessions`, `reports` and `usage_ledger` gain nullable `org_id` and `assignment_id`. `usage_ledger` gets a `meter` column (`mock`, `tokens`, later `voice_minutes`). `checkEntitlement()` compares usage by meter against `entitlements`.
- `audit_logs`: records who in an org viewed or exported whose data, plus other org actions (it doubles as the event log).

## Roles
Default roles and what they can do. This table becomes `ROLE_PERMISSIONS` in `lib/permissions.ts`; code checks the permission, never the role name.

| Action | owner | admin | coach | member |
|---|---|---|---|---|
| Billing/seats, delete org | ✓ | | | |
| Invite/remove members, manage cohorts and settings | ✓ | ✓ | | |
| Create assignments and org packs | ✓ | ✓ | ✓ | |
| View cohort analytics | ✓ | ✓ | ✓ (own cohorts) | |
| View a member's reports | limited by the member's `share_level` | same | same | own only |
| Practise, see assignments | ✓ | ✓ | ✓ | ✓ |

## Code changes (when M2 is built)
- **Authorization layer** `lib/authz.ts`, a Data Access Layer as described in `node_modules/next/dist/docs/01-app/02-guides/authentication.md`: `requireUser()`, `can(user, permission, orgId)`, `canViewMember(viewer, memberId, orgId)`. Policies live next to it in `lib/policies.ts`: `checkEntitlement(orgId, key)`, `requiresGuardianConsent(user, org)`, `orgSettings(org)` (typed, with defaults). Every org query goes through it. `proxy.ts` (the Next 16 name for middleware; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) does only optimistic cookie redirects and is never the only check.
- **Adapter**: `remoteCollection` (M2.5) stays per-user. Org data gets separate read-only hooks (`useOrg`, `useAssignments`, `useOrgAnalytics`), so existing pages don't change.
- **Routes**: `/api/orgs` (create, list mine), `/api/orgs/[orgId]/members|invites|cohorts|assignments|analytics|export`, `/api/join/[code]`. Zod schemas go in `lib/schemas.ts` (M1.1).
- **Turn/report routes** ([app/api/interview/turn/route.ts](../app/api/interview/turn/route.ts), [app/api/interview/report/route.ts](../app/api/interview/report/route.ts)): resolve the org from the session and enforce the org quota and allowed packs before calling Gemini. Write `org_id` into `usage_ledger`.
- **Member UX**: an org switcher in [components/Shell.tsx](../components/Shell.tsx); "Assigned to you" shown first on the dashboard by extending `recommendPack` in [lib/recommend.ts](../lib/recommend.ts) to prefer open assignments; org packs listed in [app/practice](../app/practice); a sharing-consent screen on join.
- **Admin UX** `app/org/[slug]/`:
  - Members: invite by email, CSV or join code; shows seats used vs. limit.
  - Cohorts and Assignments.
  - Analytics: mocks completed, average `overall`, weakest `dimensions`, filler rate from `Signals`, readiness by cohort, all aggregated from `reports` in SQL. Reuse helpers from [lib/analysis.ts](../lib/analysis.ts) and [lib/recommend.ts](../lib/recommend.ts).
  - CSV export.
- **Super-admin**: a minimal internal page or script to create orgs and set their entitlements (D13).

## Phasing
- **M2 (inside the existing milestone, task M2.10):** org tables and nullable `org_id` columns go into the first migration, plus `lib/authz.ts` and tests proving cross-user and cross-org isolation. No org UI yet. This costs little and avoids a retrofit.
- **M2-Org (≈ 2–3 weeks, right after M2's exit gate):** create org, invites and join codes, roles, cohorts, assignments, member consent, admin analytics and CSV export, seat and quota enforcement, audit log.
- **Later:** Google/Microsoft domain SSO, an org pack authoring UI with versioning, self-serve org billing (M6), white-label/subdomains, SAML/SCIM, LMS integrations, and (as a separate product decision) an employer screening mode.

## M2-Org exit gate
Automated tests show that:
1. a member of org A cannot read any org B data;
2. an admin cannot read a member's transcript when that member's `share_level` is not `full`;
3. data a member creates after leaving is invisible to the org;
4. the seat limit blocks the join that would exceed it;
5. an exhausted org quota makes `/api/interview/turn` return 429.

Playwright E2E: admin creates an org → invites → member joins with a code → member completes an assigned mock (Gemini mocked) → admin analytics shows it → CSV export works.

## Deferred decisions
Decided later; "Designed to expand" shows how each one plugs in without rework.
- **Minors:** schools and some institutes have under-18 users, which means parental consent under DPDP/GDPR.
- **Data residency:** org contracts may require India-region storage (ties to implementationPlan Q4).
- **Pricing:** per seat per year, per mock, or a pool of mock minutes per org.
- **Employer screening mode.**
