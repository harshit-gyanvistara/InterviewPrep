# Implementation Plan — Offerly (InterviewPrep)

**Audience:** engineers joining the project. **Goal:** after reading this you should understand what exists, why it is shaped the way it is, what we build next and in what order, and be able to pick up a first task.

How this fits with the other docs:

| Doc | Answers | Read it when |
|---|---|---|
| [PITCH.md](PITCH.md) | Why the product exists, who it is for | Day 1, skim |
| [USER_FLOW.md](USER_FLOW.md) | What the user sees, screen by screen | Day 1, before touching UI |
| [SPEC.md](SPEC.md) | Exact data model and API contracts of the **current** code | Before changing `lib/types.ts` or any route |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Narrative of what is built and why | Day 1 |
| [DEV_PLAN.md](DEV_PLAN.md) | The **target** production architecture and phase roadmap | When planning beyond the prototype |
| **this file** | How we get from SPEC.md (today) to DEV_PLAN.md (target), in order | Before picking up work |
| [plans/](plans/) | Focused plans for individual initiatives (e.g. [liveAgent AI service](plans/live-agent-service.md), [LLM cache → tuned-model router](plans/llm-cache-distill-router.md), [Organisations](plans/organisations.md), [Field prompts + prompt caching](plans/domain-prompts-and-caching.md)) | Before working on that initiative |

> **Doc drift warning.** SPEC.md, IMPLEMENTATION.md, USER_FLOW.md and README.md all say the app lives in `web/`. It does not: the Next.js app is at the **repo root** (`app/`, `lib/`, `components/`). Fixing those links is task M0.1 below.

---

## Part 1 — How the system works today

### 1.1 One-paragraph summary

Offerly is a single-user, browser-local AI mock-interview app. A candidate onboards (role, companies, resume), picks an interview "pack", and talks to an AI interviewer by voice (browser Web Speech API) or text. Each candidate turn is sent to a **stateless** Next.js route that calls Gemini for the interviewer's next line. When the interview ends, a second Gemini call scores the full transcript against a rubric and produces a structured report. All data lives in `localStorage`. There is no auth, no database, no tests, no CI, and no realtime media infrastructure.

### 1.2 Architecture diagram

```
┌──────────────────────────── Browser ────────────────────────────┐
│  app/* pages (client components)                                 │
│     │  read/write via hooks          speech in/out               │
│     ▼                                    ▼                       │
│  lib/db.ts  ──► localStorage        lib/useSpeech.ts             │
│  (useQuery + "interviewprep:change" event = reactivity)          │
│     │                                                            │
│     │ fetch POST with FULL context (profile, pack, messages)     │
└─────┼────────────────────────────────────────────────────────────┘
      ▼
┌──────────────── Next.js Route Handlers (server) ────────────────┐
│ /api/interview/turn   /api/interview/report   /api/pack/generate │
│ /api/roadmap          /api/ai/assist          /api/health        │
│     │  resolve field + persona; lib/liveAgent.ts::callAgent()    │
└─────┼────────────────────────────────────────────────────────────┘
      ▼  HTTP + Bearer LIVE_AGENT_TOKEN
┌──────────────── liveAgent (Python, FastAPI) ─────────────────────┐
│ /v1/interview/turn|report  /v1/packs/generate  /v1/roadmap ...   │
│     │  build prompt: live_agent/prompts.py                       │
│     ▼                                                            │
│ live_agent/gemini.py::generate_json()  ──►  Gemini text API      │
│ (Pydantic structured output; ApiError → {error}, status)         │
└──────────────────────────────────────────────────────────────────┘
```

Two properties to internalise, because most of the plan follows from them:

1. **The server is stateless.** Every API call re-sends everything it needs. This made "refresh mid-interview resumes" free, but it also means the server trusts whatever the browser sends (no ownership, no validation beyond `isValidPack`).
2. **Storage is already behind an async, collection-based adapter** (`lib/db.ts` `Collection<T>` with `list/get/put/remove`). Moving to a real database is designed to be a swap of `localCollection`, not a rewrite of pages.

### 1.3 Code map (repo root)

| Path | What it is | Notes for contributors |
|---|---|---|
| `app/layout.tsx`, `components/Shell.tsx` | Root layout, nav shell, route guard | Guard: no onboarded profile → `/welcome` |
| `app/welcome`, `app/onboarding` | Landing + 5-step wizard | `components/ProfileForm.tsx`, `DeviceCheck.tsx` |
| `app/page.tsx` | Dashboard, next-best-action | Logic in `lib/recommend.ts` |
| `app/practice` | Configure a mock, generate JD packs, Quick Mock | `components/QuickMock.tsx` |
| `app/interview/[id]/page.tsx` | Lobby → Room → Scoring (largest page, ~450 lines) | Session state machine lives here |
| `app/report/[id]` | Report view | Merges client-side `signals` |
| `app/progress`, `app/prepare` | History/trends; roadmap + STAR story bank | |
| `app/notes`, `app/cortex` | Quick notes and the Tiptap notebook | Side tools, not core loop |
| `app/settings` | Profile, interview, voice, appearance, data/AI | Export/import/delete, AI health check |
| `app/api/**/route.ts` | Six Gemini-backed route handlers | Contracts in SPEC.md §5 |
| `lib/types.ts` | **All** domain types | Change here ⇒ update SPEC.md |
| `lib/db.ts` | Storage adapter + React hooks | The seam for the DB migration. `useCatalog()` loads fields and built-in packs from `/api/catalog` |
| `lib/catalog-server.ts`, `supabase/` | Supabase catalog (fields, built-in packs): migrations, cached reads, code-default fallback | Seed with `npm run db:seed`; SPEC.md §8 |
| `lib/liveAgent.ts`, `lib/liveAgent.types.ts` | Core's client for liveAgent (`callAgent`, `ApiError`, `errorResponse`); types generated from `liveAgent/openapi.json` | AI routes are thin proxies. Run `npm run agent:types` after changing liveAgent's models |
| `liveAgent/` | The Python AI service: `live_agent/gemini.py` (`MODELS`, `generate_json`), `prompts.py`, `models.py`, `routes/` | Only place that talks to Gemini. This is the "interview engine" today. The interviewer system prompt must stay identical across a session (cache); per-turn data goes in `interview_state`. Prompts are golden-tested. See [liveAgent/README.md](liveAgent/README.md) and [plan](plans/live-agent-service.md) |
| `lib/domains/` | Field profiles (general, software, medical): prompt context, scoring rules, round hints | Add a field = add a file. See [plan](plans/domain-prompts-and-caching.md) |
| `lib/packs.ts` | Built-in packs, personas, `isTechnical`, `buildMixedPack` | Packs are data, not prompts |
| `lib/recommend.ts`, `lib/analysis.ts` | Pure business logic (no AI) | Easiest code to unit-test first |
| `lib/useSpeech.ts` | Browser STT/TTS hook | Chrome/Edge best; others fall back to text |
| `lib/dialogContext.tsx` | `useConfirm()` / `usePrompt()` | **Never** use `window.confirm/alert/prompt` |

### 1.4 Life of an interview (follow this in the code once)

1. `/practice` creates a `Session { status: "lobby" }` via `db.sessions.put`.
2. `/interview/[id]` shows the Lobby. Cancel deletes the session; Join sets `status: "active"`.
3. Each candidate answer appends a `Message`, then `POST /api/interview/turn` with `{config, profile, pack, messages, elapsedSec, code}`. The route builds `interviewerSystem(...)`, sends the **last 60** messages, gets `{reply, endInterview}`.
4. On end (button, timer + 45s, or `endInterview: true`): `status: "scoring"`, `POST /api/interview/report`. Failure → back to `active` with transcript kept.
5. The client adds `id`, `sessionId`, `packId`, `createdAt` and `signals` (from `lib/analysis.ts::computeSignals`) and saves the `Report`; session becomes `done`.

### 1.5 Running it locally

```bash
npm install
cp .env.example .env.local                    # LIVE_AGENT_URL, LIVE_AGENT_TOKEN
cp liveAgent/.env.example liveAgent/.env      # GEMINI_API_KEY + the same LIVE_AGENT_TOKEN
npm run agent:setup                           # once: Python venv for liveAgent
npm run agent                                 # terminal 1: AI service on :8000
npm run dev                                   # terminal 2: http://localhost:3000
npm run lint && npx tsc --noEmit && npm run agent:test
```

Settings → Data & AI → "AI connection test" calls `/api/health` and confirms the key and both models work.

> **Next.js 16 note (from AGENTS.md):** this Next.js version has breaking changes versus most training data and tutorials. Before writing route handlers, middleware, caching or config, read the relevant guide in `node_modules/next/dist/docs/`.

### 1.6 Conventions already in the code

- All domain types in `lib/types.ts`; all persistence through `db.*`; all Gemini calls through liveAgent's `generate_json` (Core reaches it only via `callAgent`).
- Routes return `{ error }` with `ApiError.status` (default 500). Keep that contract.
- Models are config (`MODELS` + env vars), never hardcoded at call sites.
- New settings fields must have defaults in `DEFAULT_SETTINGS`; `useSettings()` merges stored data over defaults, so old saved data keeps working.
- Truncation limits (resume 6000, JD 4000–8000, transcript 40,000, code 6000, 60 turns) are scattered magic numbers. Grep for them before changing prompt construction.

---

## Part 2 — Gap analysis: spec vs. target

SPEC.md is accurate to the code (spot-checked against `lib/db.ts`, `lib/gemini.ts`, the routes and fetch call sites). The gaps below are versus DEV_PLAN.md (the target) and versus basic production readiness.

| # | Area | Today | Target (DEV_PLAN) | Severity | Fixed in |
|---|---|---|---|---|---|
| G1 | API abuse | No auth, rate limit or quota on any `/api/*` route; anyone who can reach the server spends our Gemini budget | Per-user quotas, rate limits, usage ledger | **High** (blocks any public deploy) | M1 |
| G2 | Input validation | Ad-hoc presence checks + `isValidPack`; no schema validation | Zod schemas shared by client and server | High | M1 |
| G3 | Tests / CI | None | Unit → contract → E2E → conversation evals; CI on every PR | High | M0, M1, M4 |
| G4 | Identity & data | Single implicit user, `localStorage`, lost on clearing site data | Accounts, Postgres, cross-device | High | M2 |
| G5 | Observability & cost | `console.error` only; no token/cost tracking | OpenTelemetry, Sentry, `usage_ledger` per session | Medium | M1 (ledger), M2 (persist) |
| G6 | Interview engine | One big prompt; model decides pacing and ending | Explicit orchestrator state machine + follow-up policy | Medium | M4 |
| G7 | Scoring trust | One Pro call, no calibration, no regression tests | Versioned rubrics, human-rated calibration set, ≥0.7 correlation | Medium | M4 |
| G8 | Versioning | Packs/prompts change silently; old reports not reproducible | Every session stores pack/prompt/rubric versions | Medium | M2 (fields), M4 (process) |
| G9 | Voice | Browser Web Speech API, quality varies by browser, no barge-in | Gemini Live audio-to-audio, p95 ≤ 1.8s | Medium (core differentiator) | M3 |
| G10 | Coding round | Plain `<textarea>`, no execution | Monaco + Judge0 sandbox, tests visible to interviewer | Medium | M5 |
| G11 | Long interviews | History beyond 60 messages silently dropped | Running summary / context compression | Low | M4 |
| G12 | Business | No billing, tiers, email | Razorpay/Stripe, Free/Pro, lifecycle email | Phase-dependent | M6 |
| G13 | Privacy | Data stays in browser (good), but no consent/retention policy for when it moves server-side | DPDP/GDPR consent, retention, delete-on-request | High once M2 ships | M2 |
| G14 | Docs | Wrong `web/` paths; README says `cd web` | Accurate docs | Low (but confuses every newcomer) | M0 |
| G15 | Organisations | Single user only; no way for a college or company to give Offerly to many users | Orgs, roles, cohorts, assignments, seats, org quotas, admin analytics ([plan](plans/organisations.md)) | High (main revenue channel per PITCH) | M2 (schema), M2-Org |

**Important design reading of the gap:** DEV_PLAN.md proposes a monorepo with a separate Node API, a Python LiveKit agent, Redis, BullMQ, etc. The prototype took the opposite path (zero infra) and it works. This plan **evolves the existing Next.js app incrementally** and only introduces new services when a milestone needs them (voice needs an agent worker; coding needs a sandbox). See decision D1.

---

## Part 3 — Key technical decisions

Each decision should become a short ADR in `docs/adr/` when the milestone that needs it starts.

| ID | Decision | Recommendation | Why | Revisit if |
|---|---|---|---|---|
| D1 | Monorepo rewrite vs. evolve the Next.js app | **Evolve.** Keep Next.js route handlers as the API until a workload needs its own process | The `db` seam and stateless routes already isolate change; a rewrite delays users by weeks | Route handlers can't meet latency or long-running job needs |
| D2 | Database + ORM | **Supabase** (managed Postgres). SQL migrations in `supabase/migrations/`; `supabase-js` with the secret key on the server. Revisit an ORM (Drizzle over the Supabase connection) when user tables land in M2 | Chosen 2026-10-03; the catalog (fields, built-in packs) already lives there. Collections map 1:1 to tables; JSON columns for `messages`, `dimensions` keep the migration small | Data residency needs a region Supabase doesn't offer |
| D3 | Auth | **Supabase Auth** is now the natural fit (same project, RLS on `auth.uid()`); alternatives Better Auth or Clerk. Google + email; phone OTP before public free tier | Need user ids to scope data and quotas. Org SSO (Google Workspace / Microsoft, by email domain) is planned in D14 | SAML/SCIM required by a customer |
| D4 | Validation | **Zod** schemas in `lib/schemas.ts`, `z.infer` replaces hand-written request types | Closes G2 and gives one contract for client and server | — |
| D5 | Where state lives during an interview | Keep the client-driven, stateless turn API through M2; server writes the transcript on each turn | Preserves "refresh resumes" and keeps M2 small | M3 voice moves turn-taking to the agent |
| D6 | Voice path | Phase-0 style spike: Gemini Live via LiveKit Agents vs. current browser STT/TTS; ship Live only if p95 ≤ 1.8s from India | Voice realism is the product's differentiator, but it is the riskiest and most expensive piece | Spike misses targets → keep browser speech, improve TTS only |
| D7 | Code execution | Self-hosted Judge0 in an isolated network | DEV_PLAN default; cost-predictable | Managed sandbox becomes cheaper than ops time |
| D8 | Report generation | Stay synchronous in the route until reports exceed the platform timeout; then move to a queue | Avoid Redis/BullMQ until needed | p95 report time > 60s |
| D9 | Existing local data | One-time "import my local data" on first sign-in, using the existing `db.exportAll()` JSON shape | Early users keep their history | — |
| D10 | Tenancy model | Shared DB with `org_id` column, one deployment, path-based `/org/[slug]` | Cheapest to build and operate; no per-org infra | A customer requires isolated data or white-label domains |
| D11 | Who owns member data | The user. Orgs see activity + scores by default; transcripts/resume only if the member opts in. Leaving revokes access | Privacy (DPDP/GDPR) and member trust | — |
| D12 | Individuals vs. orgs | Users can exist without an org and belong to several; sessions record their org | Keeps B2C and B2B in one product | — |
| D13 | Org billing in M2 | `entitlements` rows (seats, mocks per month) set by us, invoiced offline; self-serve checkout in M6 writes the same rows | Avoids building org checkout before the first pilots | More than a handful of org customers |
| D14 | Org SSO | Google/Microsoft domain sign-in via the D3 library; SAML/SCIM later | Covers most colleges and small companies | — |
| D15 | Build to expand, decide later | Code checks permissions and entitlements, never role or plan names; each business policy sits in one function; limits, consents and usage are keyed rows; growing lists are validated strings, not DB enums. See [plans/organisations.md § Designed to expand](plans/organisations.md#designed-to-expand) | Pricing, minors, data residency and screening mode are deferred; answering them later should be config, not a rewrite | — |

---

## Part 4 — Milestones

Milestones are sequential at the top level; work inside a milestone can be parallel. Each has an exit gate; do not start the next milestone's user-facing work until the gate passes. Sizes are rough for a team of 2–3 engineers.

### M0 — Make the repo team-ready (≈ 1 week)

Goal: a new engineer can clone, run, and get a green CI check on their first PR.

| Task | Detail |
|---|---|
| M0.1 Fix docs | Replace `web/` paths in SPEC.md, IMPLEMENTATION.md, USER_FLOW.md; remove `cd web` from README; fix the `web/.env.local` hint in `lib/gemini.ts` error message |
| M0.2 `.env.example` | `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_SCORING_MODEL` |
| M0.3 Test runner | Add Vitest; first tests for pure functions: `lib/recommend.ts` (`recommendPack`, `streakDays`, `daysUntil`), `lib/analysis.ts::computeSignals`, `lib/packs.ts` (`isTechnical`, `buildMixedPack`), `lib/prompts.ts::toTurns` |
| M0.4 CI | GitHub Actions: `npm ci`, `lint`, `tsc --noEmit`, `vitest run`, `next build` on every PR |
| M0.5 Scripts | `npm run typecheck`, `npm test` in `package.json` |
| M0.6 PR template + CONTRIBUTING | Link this plan; checklist "updated SPEC.md if types/routes changed" |

**Exit:** CI green on `main`; ≥ 80% line coverage on `lib/recommend.ts`, `lib/analysis.ts`, `lib/packs.ts`.

### M1 — Harden the API (≈ 1–2 weeks)

Goal: safe to deploy publicly as a demo, even before accounts exist.

| Task | Detail |
|---|---|
| M1.1 Zod schemas (D4) | `lib/schemas.ts` for every route body; return 400 with field errors; delete ad-hoc checks once covered |
| M1.2 Rate limiting | Per-IP limit on all `/api/*` (e.g. Upstash Ratelimit or a Next.js middleware/proxy, check Next 16 docs for the current name); stricter on `/report` and `/pack/generate` (Pro model) |
| M1.3 Centralise limits | Move truncation numbers into `lib/limits.ts`; tests assert prompts respect them |
| M1.4 Usage capture | `generate_json` (liveAgent) returns Gemini usage metadata; log `{route, model, inputTokens, outputTokens, ms}` (structured logs now, `usage_ledger` table in M2) |
| M1.5 Error tracking | Sentry (or equivalent) for routes and client |
| M1.6 Route contract tests | liveAgent's side exists (`liveAgent/tests/test_routes.py`, Gemini mocked). Still to do: Core routes with `callAgent` mocked; test each route's 400/422/502/503 paths and response shaping (e.g. `overall` clamping, packs capped to 3) |
| M1.7 Deploy | Preview deploys per PR (e.g. Vercel) + a staging environment with its own Gemini key and budget alert |

**Exit:** all routes schema-validated and rate-limited; contract tests in CI; staging URL live; cost per mock visible in logs.

### M2 — Accounts and server persistence (≈ 3–4 weeks)

Goal: real users, data across devices, foundation for billing and B2B.

| Task | Detail |
|---|---|
| M2.1 Auth (D3) | Sign-in, session cookie, `userId` available in route handlers; `/welcome` becomes public, everything else requires auth + onboarding |
| M2.2 Schema (D2) | Tables: `users`, `profiles`, `settings`, `sessions` (messages as JSONB to start), `reports`, `custom_packs`, `roadmaps`, `stories`, `notes`, `binders`, `cortex_pages`, `usage_ledger`. Every row has `user_id` |
| M2.3 Versioning fields (G8) | `sessions.pack_snapshot` (the exact pack JSON used), `prompt_version`, `rubric_version`, `model_ids` |
| M2.4 CRUD routes | `/api/db/[collection]` (or per-resource routes) with ownership checks on every read/write |
| M2.5 Swap the adapter | Re-implement `localCollection` as `remoteCollection` calling M2.4; keep the same `Collection<T>` interface and the change-event reactivity so pages don't change |
| M2.6 Server-trusted context | `/api/interview/turn` and `/report` load `profile`, `pack` and `session` from the DB by `sessionId` instead of trusting the body; client sends only the new answer + code |
| M2.7 Local import (D9) | First sign-in offers to upload the `exportAll()` JSON |
| M2.8 Privacy | Consent copy, retention policy, "delete my account" deleting all rows, export (DSAR) via existing export JSON |
| M2.9 E2E | Playwright: onboarding → mock (text mode, Gemini mocked) → report → progress |
| M2.10 Org-ready schema | `organizations`, `memberships`, `entitlements`, `consents`, `cohorts`, `invites`, `assignments`, `audit_logs` tables, nullable `org_id`/`assignment_id` on `sessions`, `reports`, `usage_ledger`, `custom_packs`, and a `meter` column on `usage_ledger`, all in the first migration; `lib/authz.ts` (`can()`), `lib/permissions.ts`, `lib/policies.ts` (D15); cross-user and cross-org isolation tests. No org UI yet. See [plans/organisations.md](plans/organisations.md) |

**Exit:** two devices see the same history; no route reads another user's data (tested); E2E green in CI.

### M2-Org — Organisations (≈ 2–3 weeks, right after M2)

Goal: a college, company or institute can give Offerly to its people for learning and mock practice. Full plan: [plans/organisations.md](plans/organisations.md).

| Task | Detail |
|---|---|
| O.1 Org CRUD + super-admin | Create orgs and set their entitlements (D13); `/api/orgs` routes behind `lib/authz.ts` |
| O.2 Members | Invites by email, CSV and join code; roles `owner/admin/coach/member`; seat limit enforced |
| O.3 Consent | Sharing screen on join (`share_level`: activity / scores / full) (D11) |
| O.4 Cohorts + assignments | Admins/coaches assign packs to cohorts with due dates; `recommendPack` puts open assignments first |
| O.5 Quotas | Turn/report routes call `checkEntitlement()` and check allowed packs before calling Gemini; `usage_ledger` records `org_id` and `meter` |
| O.6 Admin dashboard | `app/org/[slug]/`: members, cohorts, assignments, analytics by cohort, CSV export, audit log |
| O.7 Member UX | Org switcher in `components/Shell.tsx`; org packs in `/practice` |

**Exit:** isolation tests (org A vs. org B, share levels, removed members, seat limit, quota 429) and the admin → invite → join → assigned mock → analytics E2E are green in CI.

### M3 — Voice realism (≈ 1 week spike + 3–4 weeks build, gated)

Goal: the interviewer sounds and reacts like a person. This is the highest-risk milestone; it starts with a spike and can be cancelled.

| Task | Detail |
|---|---|
| M3.0 Spike (D6) | LiveKit + Gemini Live agent; measure p50/p95 mouth-to-ear latency from an India region, barge-in quality, session-length limits, cost per 30-min mock. Write ADR with go/no-go |
| M3.1 Agent worker | Separate deployable (`agent/`, Python LiveKit Agents per DEV_PLAN or Node if viable) holding the Gemini key; reuses `interviewerSystem` logic (port or share prompt templates) |
| M3.2 Room UI | LiveKit tokens from a new route; captions from Live transcription; keep the text-mode path as fallback |
| M3.3 Transcript tap | Agent writes turns to `sessions.messages` so scoring (unchanged) works on the same transcript |
| M3.4 Reconnect | Network drop resumes the same session (DEV_PLAN S4) |

**Exit:** p95 ≤ 1.8s; session failure rate < 3% over 50 internal mocks; cost per mock within budget. If the spike fails: improve browser TTS/STT quality and move on to M4.

### M4 — Interview engine and scoring you can trust (≈ 3–4 weeks, can overlap M3)

| Task | Detail |
|---|---|
| M4.1 Orchestrator (G6) | Explicit phases `intro → warmup → question loop → candidate questions → wrap-up` tracked server-side; prompt receives the current phase and remaining topics instead of deciding everything itself |
| M4.2 Follow-up policy | Per-answer quick assessment (Flash) chooses probe / challenge / hint / move on, by persona and time left |
| M4.3 Context summary (G11) | Replace "last 60 messages" with running summary + recent turns |
| M4.4 Eval harness | Scripted simulated candidates (strong, weak, evasive, rambling, injection-attempt) run against each pack; assert flow, timing, and that injection attempts lower professionalism scores. Runs in CI on prompt/pack changes (nightly for the full set) |
| M4.5 Calibration set | 100+ human-rated answers; measure correlation per dimension; target ≥ 0.7 |
| M4.6 Report feedback | "Was this fair?" rating on reports, stored per report |

**Exit:** eval suite blocks regressions in CI; correlation target met on core dimensions.

### M5 — Coding round (≈ 3 weeks)

| Task | Detail |
|---|---|
| M5.1 Monaco editor | Replace the textarea in `app/interview/[id]/page.tsx`; language selector |
| M5.2 Sandbox (D7) | Judge0 behind `/api/code/run`; CPU/memory/time caps, no network; rate-limited |
| M5.3 Problems | `problems` table, starter set tagged by topic/company; tests visible to interviewer prompt |
| M5.4 Interviewer awareness | Run results included in the turn context; scorer sees final code + test results |

**Exit:** ≥ 80% of started coding rounds complete; median run < 3s.

### M6 — Business and growth (≈ 3 weeks)

Free/Pro tiers enforced from `usage_ledger`; Razorpay (+ Stripe) checkout and webhooks; lifecycle email (reminders tied to `weeklyGoal` and `interviewDate`); product analytics events; shareable readiness card.

**Exit:** a stranger can sign up, hit the free limit, pay, and continue.

### Later (DEV_PLAN Phases 3–5)

Org extras beyond M2-Org (domain SSO, white-label, SAML/SCIM, LMS integrations, self-serve org billing), pack authoring admin UI with versioning, async one-way interview simulator, panel/GD with multiple agents, human mock marketplace, job tracker. Plan these once M2–M4 are done and the pitch §14 decisions are made.

### Sequencing at a glance

```
M0 ─► M1 ─► M2 ─┬─► M2-Org ─────────────────┐
                ├─► M3 (spike gates build) ─┤
                ├─► M4 ─────────────────────┼─► M6 ─► Later
                └─► M5 ─────────────────────┘
```

M2-Org, M3, M4 and M5 all depend on M2 (server-side sessions) and are independent of each other, so a team of three can run them in parallel.

---

## Part 5 — Starting as a contributor

### First week

1. Read USER_FLOW.md, then IMPLEMENTATION.md, then skim SPEC.md.
2. Run the app with your own Gemini key and complete one full mock and one Quick Mock.
3. Trace §1.4 above through `app/interview/[id]/page.tsx`, `app/api/interview/turn/route.ts`, `liveAgent/live_agent/routes/interview.py`, `liveAgent/live_agent/prompts.py`.
4. Pick a starter task below.

### Good first tasks (small, low-risk, high value)

| Task | Files | Milestone |
|---|---|---|
| Fix `web/` paths in docs | `*.md` | M0.1 |
| Add `.env.example` | root | M0.2 |
| Add Vitest + tests for `computeSignals` | `lib/analysis.ts` | M0.3 |
| Tests for `recommendPack` rules (USER_FLOW §6) | `lib/recommend.ts` | M0.3 |
| GitHub Actions CI | `.github/workflows/ci.yml` | M0.4 |
| Zod schema for `/api/ai/assist` (smallest route) | `lib/schemas.ts`, route | M1.1 |

### Definition of done for any PR

- `lint`, `typecheck`, tests and `next build` pass.
- If `lib/types.ts` or any route request/response shape changed, SPEC.md is updated in the same PR.
- No Gemini SDK calls outside `liveAgent/live_agent/gemini.py`; no hardcoded model ids. A prompt change updates its golden in `liveAgent/tests/fixtures/prompts.json`; a contract change re-runs `npm run agent:types`.
- No `window.confirm/alert/prompt`; use `useConfirm()` / `usePrompt()`.
- User-visible behaviour changes are reflected in USER_FLOW.md.

---

## Part 6 — Open questions for the owner

These change the plan; answers should be recorded as ADRs.

1. **Pitch §14 decisions** are still open (geography, beachhead, name, budget). *Partly answered:* the product targets both individuals and organisations; org support is pulled into M2/M2-Org, for learning and mock practice only (no employer screening yet).
2. **Team size and timeline.** The sizes above assume 2–3 engineers. Solo, follow DEV_PLAN §11: M0 → M1 → M2 → M4, defer M3 and M5.
3. **Voice ambition.** Is Gemini Live voice a must for launch, or is browser speech acceptable for the first paying users?
4. **Hosting.** Vercel + managed Postgres is the fastest path; an India-region requirement for data residency or latency may push us to GCP/AWS Mumbai.
5. **Cortex and Notes.** They are not in the pitch. Keep as-is, invest, or freeze while the core loop matures?
6. **Raw audio.** Store recordings at all in v1, or transcripts + derived signals only (cheaper, more private)?
7. **Minors in orgs** (deferred). Schools and some institutes have under-18 users, which needs parental consent. The design supports adding this later (D15).
8. **Org pricing** (deferred). Per seat per year, per mock, or a pool of mock minutes per org. Any of these maps onto `entitlements` (D15).
