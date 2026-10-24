# Flows

How requests, sign-in, interviews, usage and deploys move through Offerly, and how the build has moved away from the initial plan. Screen-by-screen UX is in [USER_FLOW.md](USER_FLOW.md); exact request/response shapes are in [SPEC.md](SPEC.md); why each choice was made is in [DECISIONS.md](DECISIONS.md).

Update this file in the same commit as any change to a flow below.

---

## 1. An AI request (every `/api/*` AI route)

```
Browser / Android WebView
  │  POST /api/interview/turn  (session cookie)
  ▼
Core: Next.js route handler
  1. authorize(req, bucket)      lib/route.ts
       requireUser()             lib/auth.ts      → 401 signed out; 503 if AUTH_MODE=off in production
       beta list                 lib/emailPolicy.ts → 403 if not in BETA_ALLOWED_EMAILS
       enforceRateLimit()        lib/rateLimit.ts → 429 + Retry-After (per user; per IP with AUTH_MODE=off)
       requireAllowance(ai_calls) lib/policies.ts → 429 when the package's daily AI calls are used
  2. parseBody(req, Schema)      lib/schemas.ts   → 413 over 1 MB, 400 with field issues
  3. resolve field + persona     lib/domains, catalog from Supabase (5-min cache)
  4. callAgent(path, body, {user})  lib/liveAgent.ts
       │  Bearer LIVE_AGENT_TOKEN, X-Request-Id
       ▼
     liveAgent: FastAPI /v1/*    liveAgent/live_agent/
       require_core (token)      → 401 / 503
       Pydantic validation       → 400
       prompt builder            prompts.py, limits.py
       generate_json()           gemini.py ──► Gemini (structured JSON output)
       ◄── JSON  +  X-LLM-Usage header (one record per Gemini call)
     (interview/turn, first turn only: requireAllowance(mocks) → 429 when today's mocks are used)
  5. recordUsage(...)            lib/usage.ts → ai.usage log line
     addUsage(ai_calls)          lib/policies.ts → usage_ledger row (interview/report also adds a mock)
  6. return JSON, or errorResponse(e) → { error, issues? } with liveAgent's status
                                  (unreachable 503, timeout 504)
```

The browser never talks to liveAgent, and liveAgent never sees a database or a user's identity beyond what Core sends.

## 2. Sign-in

```
Signed-out page request ──► proxy.ts ──► redirect /welcome   (API requests get 401 instead)

/sign-in
 ├─ Email:  POST /api/auth/otp  (rate-limited per IP; temporary inboxes and, in the beta, emails not in BETA_ALLOWED_EMAILS refused) ──► Supabase sends an email with a code and a link (via Resend, from no-reply@mail.build-score.com)
 │     ├─ Code (web and app):  POST /api/auth/verify ──► session cookies + terms consent ──► /
 │     └─ Link (only in the browser that asked): /auth/callback (PKCE) ──► session + consent ──► /
 └─ Google (web only; hidden in the app via isInApp()):
       /auth/google ──► Google ──► /auth/callback ──► session + consent ──► /

Shell guard: no server profile ──► /onboarding.  Sign-out: POST /api/auth/sign-out (no page reload).
```

`proxy.ts` only refreshes the session and redirects pages; route handlers check the user themselves, and row-level security checks again in the database. With `AUTH_MODE=off` (local work, CI) everyone is the one `local` user.

## 3. Where data lives

| Data | Where | Notes |
|---|---|---|
| Profile | Supabase `profiles` (JSONB) via `/api/db/profile` | Same profile on web and app |
| Users, terms consent | Supabase `users`, `consents` | RLS: own rows only; delete account cascades |
| Sessions, reports, roadmaps, stories, settings, custom packs, notes, Cortex | Supabase, one table each (`data` JSONB, key `(user_id, id)`), via `/api/db/<name>` | Cached in memory per page load; saves go through a retry queue kept in localStorage (top bar shows "Saving N changes…"). Older browser data is uploaded once on sign-in. [plans/server-history.md](plans/server-history.md) |
| Everything, with `AUTH_MODE=off` | Browser `localStorage`, unprefixed keys | Local work and CI only |
| Organisations, memberships, cohorts, assignments, entitlements, invites, audit log | Supabase (M2.10, no UI yet) | Members read their orgs, their own membership, and those orgs' cohorts and assignments. Everything else is server-only, through `lib/authz.ts`. [plans/org-ready-schema.md](plans/org-ready-schema.md) |
| Fields and built-in packs | Supabase `domains`, `packs` | Code copies are the seed and the fallback |

## 3b. Organisations (super-admin, M2-Org O.1)

1. Someone listed in `SUPER_ADMIN_EMAILS` opens `/admin/orgs` (everyone else gets 404 from the API).
2. They create an org (name, address/slug, kind, optional owner email) and set its plan as `entitlements` rows (seats, mocks per period, any key) plus settings. Marketing does this; no SQL ([plans/m2-org.md](plans/m2-org.md)).
3. An owner email that has an account becomes an owner straight away; otherwise it gets a one-time owner invite link (only its hash is stored).
4. Every change is written to `audit_logs`. All of it runs on the server with the secret key.
5. **Inviting (O.2):** an owner/admin opens `/org/<slug>` and creates email invites (one single-use link per address; pasting a CSV works) or a reusable join code like `K7QM4-XR2PD`. Links and codes are shown once; only their hashes are stored.
6. **Joining:** `/join/<token or code>`. Signed out: the invite is kept in the browser, the person signs in, and comes straight back. Signed in: they see the org, choose what it may see (activity / scores / full), and join.
7. **Changing or leaving (O.3):** Settings → Organisations lists the member's orgs. Changing the share level revokes the old `org_share` consent and records a new one, so it takes effect at once. Leaving sets the membership to `removed` and revokes sharing; their history stays theirs. The last owner can't leave.
8. **Practising for an org (O.4):** a member picks "For <org>" in the top-bar switcher (or on /practice, which then shows only the org's allowed rounds). New sessions carry `config.orgId`. On the session's first AI call the server checks the membership and allowed rounds (`checkOrgPractice`), stamps `sessions.org_id`, and checks the org's `mocks` entitlement instead of the user's package. The report records usage with `org_id`, and saving the report copies `org_id`/`assignment_id` from its session. Solo practice is unchanged.
9. **Cohorts and assignments (O.5):** on `/org/<slug>`, admins create cohorts and place members in them; coaches and admins set assignments (a built-in round, everyone or one cohort, optional due date, mocks each). Members see open ones first in the dashboard's next step and on the org page. Starting one opens `/practice?pack=…&assignment=…`, which practises for that org; on the first AI call the server checks the assignment and stamps `sessions.assignment_id`, and the report copies it. Admins see "n of m done" per assignment, counted from reports.
10. **Admin dashboard (O.6):** `/org/<slug>` shows Overview (seats, mocks against the plan, assignment completion, who's been quiet 7+ days), Members (role changes, removal, sharing level, mocks, last practice, readiness where shared), Analytics by cohort, and the Audit log. Everything is read on the server from org-stamped reports and sessions, then cut to each member's share level (`lib/orgAnalytics.ts`). Opening a member (`/org/<slug>/members/<id>`, transcripts only at "full") and exporting the CSV are written to `audit_logs`. `join_org` (one database function) checks the invite, email or domain rule and seat limit with the org row locked, then adds the membership, the `org_share` consent and an audit entry.

## 4. One interview

1. `/practice` creates a session (`lobby`).
2. `/interview/[id]`: Lobby → Join (`active`).
3. Each candidate answer → `POST /api/interview/turn` with `{ sessionId, answer, elapsedSec, code }` (flow 1). The server loads the transcript, profile and pack from Supabase (the pack is frozen into `sessions.pack_snapshot` on the first call), adds the answer and the reply, saves them, and returns the reply as a message. The client saves that same message, so a refresh resumes. A 409 (the session's first save hasn't arrived yet) is retried once.
4. End (button, timer + 45 s, or the model ends it) → `scoring` → `POST /api/interview/report` with `{ sessionId, code }`; the transcript comes from the server (Pro model, up to 115 s). On failure it returns to `active` with the transcript kept.
   Each call stamps `prompt_versions`, `rubric_version` and `model_ids` on the session ([plans/session-versioning-and-trusted-context.md](plans/session-versioning-and-trusted-context.md)). With `AUTH_MODE=off` the browser also sends `context` (config, profile, pack, messages), and nothing is saved on the server.
   liveAgent adds coverage (answers given against expected): too few answers gives "Too short" with a capped score, shown without a number and left out of averages ([plans/honest-scoring.md](plans/honest-scoring.md)).
5. The client saves the report with signals from `lib/analysis.ts`; the session becomes `done`.

## 5. Usage and cost

```
generate_json ─ one record per Gemini call ─► llm.usage log line (liveAgent, with requestId)
              └─► X-LLM-Usage header ─► callAgent ─► recordUsage ─► ai.usage log line (Core, with userId)
```

Records cover failed calls (`ok: false`) and thinking tokens. Join the two services' lines on `requestId`. Plan: [plans/usage-capture.md](plans/usage-capture.md).

**Allowances** ([plans/usage-limits.md](plans/usage-limits.md)): each user's package (the `packages` table, edited in Supabase and applied within a minute; `lib/packages.ts` holds the fallback; everyone on `beta`: 5 mocks and 150 AI calls a day, reset at midnight IST) is checked against the `usage_ledger` table. `GET /api/usage` returns used / limit / reset per meter; the dashboard and lobby show mocks left.

## 6. Deploy (demo)

```
Internet ──HTTPS──► Railway service "core"  (repo root, Next.js, public domain)
                          │  http://<liveagent private domain>:8080  (Railway private network)
                          ▼
                    Railway service "liveagent"  (liveAgent/Dockerfile, no public domain) ──► Gemini
core ──► Supabase (auth, profiles, catalog)        core ──► Upstash Redis (rate limits)
```

Region: Singapore. Config lives in `railway.json` (Core) and `liveAgent/railway.json`. Project `interviewprep`; demo URL (not for real users until rollout): https://build-score.com (also www; DNS in Cloudflare, CNAMEs to Railway; fallback https://core-production-f5c0.up.railway.app). Hobby allows one region per service: set every other region (including `sfo`) to 0 with `railway scale`.

---

## Initial plan and deviations

**The initial plan** ([implementationPlan.md](implementationPlan.md), 2026-10-01): evolve the single Next.js app, with Gemini called from its route handlers (D1). Milestones in order: M0 team-ready → M1 harden the API (Zod, rate limits, limits, usage, error tracking, contract tests, deploy) → M2 accounts and server persistence → M2-Org, M3 voice, M4 engine and scoring, M5 coding round in parallel → M6 business. Orgs were "Later"; there was no mobile app.

**What changed:**

| # | Date | Initial plan | What we did | Why |
|---|---|---|---|---|
| 1 | 2026-10-04 | D1: keep Next.js route handlers as the API | All AI moved to **liveAgent**, a Python service in the same repo | One backend for web and mobile; voice and ML tooling are Python |
| 2 | 2026-10-03 | Orgs in "Later" | Org-ready schema pulled into **M2.10**, org features into **M2-Org** | Owner: product serves individuals and organisations |
| 3 | 2026-10-08 | M1.2 rate limiting in middleware | In each route handler (`authorize()`) | Next 16 advises against shared state in `proxy.ts` |
| 4 | 2026-10-14 | No mobile app | **Expo Android app** wrapping the web app in a WebView | Mobile-first users |
| 5 | 2026-10-14 | Sign-in with a browser Supabase client; magic links or Google | Server-side sign-in routes; **email code** everywhere, Google on the web only, link as a browser convenience | Google and magic links don't work inside the WebView |
| 6 | 2026-10-14 | Finish M1 (incl. M1.7 deploy) before M2 | **M2.1 sign-in built before M1.4, M1.5 and M1.7** | Reason not recorded at the time. Side effect: sign-in hasn't run against a real Supabase project yet |
| 7 | 2026-10-14 | M1.6 tests route-level shaping in Core | Shaping moved to liveAgent and tested there | It belongs with the prompts that produce the data |
| 8 | 2026-10-15 | M1.3 `lib/limits.ts` | `liveAgent/live_agent/limits.py` | Prompts live in liveAgent |
| 9 | 2026-10-18 | M1.4 log usage in `generate_json` | liveAgent measures, **Core records against the user** via a header | Core owns users and the future ledger |
| 10 | 2026-10-18 | M1.7 "e.g. Vercel", preview deploy per PR | **Railway** for both services, liveAgent private; no PR previews | Existing Railway Hobby plan; work is committed on the branch without PRs |
