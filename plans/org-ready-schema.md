# Plan: Org-ready schema (M2.10)

**Status: built (2026-10-19).** Implements [implementationPlan.md](../implementationPlan.md) M2.10, the M2 slice of [plans/organisations.md](organisations.md). Tables, row-level security, the permission layer and isolation tests. No org UI or org routes: those are M2-Org.

## Context
Sessions, reports, consents and `usage_ledger` already have a nullable `org_id` with no foreign key, waiting for this. M2-Org (create org, invites, cohorts, assignments, admin analytics) needs the tables and a single place that answers "may this person do this in this org?", so routes never check role names.

## Design

**Tables** (one migration). Strings over enums for anything that will grow, validated in code (D15):
- `organizations`: id, name, unique slug, kind (text), data_region (default `default`), settings JSONB, created_at/updated_at.
- `memberships`: org_id, user_id, role (text), status (`invited|active|removed`), cohort_id?, joined_at; unique (org_id, user_id).
- `entitlements`: org_id, key (`seats`, `mocks`, …), limit (null = unlimited), period (`none|day|month|year`), source (`manual`; `billing` from M6); unique (org_id, key).
- `cohorts`: org_id, name, archived.
- `invites`: org_id, email?, token_hash (unique), role, cohort_id?, expires_at, max_uses, uses, created_by.
- `assignments`: org_id, cohort_id?, pack_id, title, due_at?, target_mock_count, created_by.
- `audit_logs`: org_id, actor_id, action (text), target_user_id?, details JSONB, created_at. Append-only: it doubles as the org event log.
- Foreign keys from the existing `org_id` columns (sessions, reports, consents, usage_ledger) to `organizations`, `on delete set null` (consents: cascade, since sharing with a deleted org means nothing), so deleting an org never deletes members' data (D11). `assignment_id` (nullable, foreign key to `assignments`) on sessions, reports and usage_ledger; `org_id` on custom_packs.

**Row-level security: membership, never cross-user.**
- A user can read the orgs they're an active member of, their own membership rows, and the cohorts and assignments of their orgs.
- Nobody reads another user's sessions, reports or transcripts through RLS, not even an org admin. Admin views (M2-Org) go through server routes that check `can()` / `canViewMember()`, use the secret key and write `audit_logs`. The "user owns their data" rule (D11) holds at the database level, and share levels stay in one code path instead of being copied into SQL.
- `entitlements`, `invites` and `audit_logs` have no user policies at all (server only). Users can't write any org table directly; all org writes go through server routes in M2-Org.
- `public.is_org_member(org)` is a `security definer` helper, so the policies don't recurse through `memberships`.

**Permission layer (code).**
- `lib/permissions.ts` (client-safe): `PERMISSIONS`, and `ROLE_PERMISSIONS` for owner / admin / coach / member, matching the roles table in organisations.md. Share levels `activity < scores < full`; the default is `scores`.
- `lib/authz.ts` (server):
  - `can(user, permission, orgId)`: active membership plus the role's permissions.
  - `requirePermission()`: 403 otherwise.
  - `canViewMember(viewer, memberId, orgId, level)`: the viewer has `members.view_reports`, the member is active in that org, and the member's latest unrevoked `org_share` consent allows `level`.
  - Lookups go through an `OrgStore` interface: the secret-key client in production, in-memory in tests, the same pattern as `UsageStore`. With no store (no secret key) every check denies (fails closed).
- `lib/policies.ts` adds `orgSettings(org)` (typed, with defaults) and `requiresGuardianConsent()` (false for now).

**Tests.**
- `lib/authz.test.ts`: roles, inactive/removed members, cross-org, share levels, consent revoked, no store → deny.
- `supabase/tests/rls.test.ts` (CI `database` job, local Supabase): cross-org isolation. A member of org A can't read org B, its memberships, cohorts or assignments. Nobody can read entitlements, invites or audit logs. A member can't read another member's sessions even in the same org. Users can't insert into org tables.

## Decided later → built now → expands to
| Later | Now | Expands to |
|---|---|---|
| Custom roles | `ROLE_PERMISSIONS` map in code | A `roles` table per org; `can()` callers unchanged |
| Pricing / seats | `entitlements` rows, nothing enforces them yet | O.5: `orgEntitlement()` sums `usage_ledger` by org |
| Coach scoped to own cohorts | `cohort_id` on memberships | `can()` gains an optional cohort scope |
| Data residency | `data_region` column | Route DB access by region |
| Screening mode, SSO domains | `settings` JSONB via `orgSettings()` | New keys with defaults, no migration |

## Action items
1. Migration `<date>_organizations.sql` (tables, foreign keys, RLS, grants, helper function, triggers).
2. `lib/permissions.ts`, `lib/authz.ts`, `lib/policies.ts` additions.
3. Tests: `lib/authz.test.ts`, cross-org cases in `supabase/tests/rls.test.ts`.
4. Docs: implementationPlan M2.10, DECISIONS, FLOWS § Where data lives; apply the migration on Supabase.
