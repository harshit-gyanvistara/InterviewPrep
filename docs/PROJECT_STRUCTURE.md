# Project structure

How the repository is laid out, what each part does, and where new code goes. For how requests move between the parts, see [FLOWS.md](../FLOWS.md); for exact types and API shapes, see [SPEC.md](../SPEC.md).

## The system in one picture

```
 Web browser            Android / iOS app (mobile/, a WebView around the web app)
      │                          │
      └──────────┬───────────────┘
                 ▼  HTTPS, session cookie
 ┌──────────────── Core (Next.js 16, repo root) ─────────────────┐
 │ pages in app/        API routes in app/api/                    │
 │ sign-in, data, usage limits, orgs, permissions (lib/)          │
 └───────┬──────────────────────────────────┬────────────────────┘
         │ Bearer LIVE_AGENT_TOKEN           │ supabase-js
         ▼ (private network in deploy)       ▼
 ┌──── liveAgent (Python, liveAgent/) ──┐   ┌──── Supabase ─────────────────────┐
 │ FastAPI: prompts, scoring rules,     │   │ Postgres + Auth                    │
 │ token usage. No database, no users.  │   │ users, profiles, sessions, reports,│
 └──────────────┬───────────────────────┘   │ usage ledger, orgs, catalog        │
                ▼                            │ row-level security on every table  │
             Gemini                          └────────────────────────────────────┘
```

Three rules hold everywhere:

1. **The browser never talks to liveAgent or Gemini.** Every AI feature goes Browser → Core `/api/*` → liveAgent → Gemini. Only liveAgent holds the Gemini key.
2. **liveAgent is stateless.** It never sees a database. Core loads what it needs and sends it.
3. **The server decides what counts.** Signed in, the interview transcript, pack and profile come from the database, not the request body. Usage, org and assignment stamps are written by the server only.

## Top-level folders

| Path | What it is |
|---|---|
| `app/` | Next.js App Router: every page and every API route |
| `components/` | Shared React components; `components/org/` for the org dashboard, `components/cortex/` and `components/notes/` for the notebook tools |
| `lib/` | All the logic Core runs: types, storage, sign-in, permissions, usage, orgs, the liveAgent client, pure business rules. Tests sit next to the code as `*.test.ts` |
| `liveAgent/` | The Python AI service: prompts, Gemini client, scoring rules, its own tests and evals |
| `supabase/` | Database migrations (SQL), local config, email template, row-level security tests |
| `mobile/` | Expo app: one screen, a full-screen WebView of the web app |
| `e2e/` | Playwright end-to-end tests and a stub liveAgent |
| `scripts/` | Running liveAgent from npm, seeding the catalog, pushing secrets to Railway |
| `plans/` | One plan per initiative, each with a status line |
| `docs/` | This onboarding set |
| `public/` | Static files |
| `.github/` | CI workflow and PR template |

Root files: `proxy.ts` (Next 16's renamed middleware: refreshes the session, redirects signed-out page loads), `next.config.ts`, `railway.json` (Core deploy), `vitest.config.mts`, `playwright.config.ts`, `eslint.config.mjs`, `.env.example`.

## `app/`: pages

| Route | Page | Who |
|---|---|---|
| `/welcome` | Landing | Public |
| `/sign-in` | Email code, Google on the web | Public |
| `/terms`, `/privacy` | Draft legal text | Public |
| `/onboarding` | 5-step setup wizard | Signed in |
| `/` | Dashboard: next best action, goals, mocks left | Onboarded |
| `/practice` | Choose a round, persona, duration, pressure; generate rounds from a job description; Quick Mock | Onboarded |
| `/interview/[id]` | Lobby → interview room → scoring (the largest page; the session state machine lives here) | Session owner |
| `/report/[id]` | Scored report | Report owner |
| `/progress` | Trend chart, weak areas, history | Onboarded |
| `/prepare` | Weekly roadmap and STAR story bank | Onboarded |
| `/notes` | Quick notes (also a drawer on every page: press `n`) | Onboarded |
| `/cortex` | Rich-text notebook (binders → pages) | Onboarded |
| `/settings` | Profile, interview, voice, appearance, organisations, data and AI | Onboarded |
| `/join/[token]` | Join an org from an invite link or code | Anyone with the link |
| `/org/[slug]` | Org page: member view, or the admin dashboard | Org members |
| `/org/[slug]/members/[userId]` | One member's detail, at their share level | Org admins and coaches |
| `/admin/orgs`, `/admin/orgs/[id]` | Create orgs, set plans and owners | Super-admins |

Also: `app/auth/google` and `app/auth/callback` (Google sign-in and email links), `app/opengraph-image.tsx` (share image), `app/globals.css` (design tokens as CSS variables).

## `app/api/`: routes

| Group | Routes | Notes |
|---|---|---|
| AI (proxy to liveAgent) | `interview/turn`, `interview/report`, `pack/generate`, `roadmap`, `ai/assist`, `health` | Thin: `authorize()` → `parseBody()` → `callAgent()` |
| Sign-in and account | `auth/otp`, `auth/verify`, `auth/me`, `auth/sign-out`, `account` (delete) | No Supabase client in the browser; sign-in runs through these |
| User data | `db/[collection]`, `db/[collection]/[id]` | List, upsert, delete for the signed-in user's own rows |
| Catalog and usage | `catalog`, `usage` | Fields and built-in rounds; used / limit / reset per meter |
| Member side of orgs | `me/orgs`, `me/assignments`, `join/[token]`, `orgs/[slug]/me` | |
| Org admin | `orgs/[slug]` and its `members`, `invites`, `cohorts`, `assignments`, `dashboard`, `export`, `audit` | Every one checks a permission with `can()` first |
| Super-admin | `admin/orgs`, `admin/orgs/[orgId]` and its `entitlements`, `owners` | Gated by `SUPER_ADMIN_EMAILS` |

## `lib/`: grouped by job

| Job | Files |
|---|---|
| **Types** | `types.ts`: every domain type. Change it and update SPEC.md |
| **Route plumbing** | `route.ts` (`authorize`, `parseBody`), `schemas.ts` (Zod request bodies and request caps), `rateLimit.ts` |
| **Sign-in** | `auth.ts` (`requireUser`, the only code that knows `AUTH_MODE`), `pages.ts` (which pages are public), `emailPolicy.ts` (throwaway inboxes, beta list), `inApp.ts` (detects the mobile app) |
| **Supabase clients** | `supabase-server.ts` (user-scoped, RLS applies), `supabase.ts` (secret key, server only, bypasses RLS) |
| **Storage** | `db.ts` (the `db` object every page uses: one async collection per kind of data, memory cache, save queue), `userData.ts` and `userCollectionRoute.ts` (the server side) |
| **Interviews** | `interviewContext.ts` (loads and saves the trusted context for turn and report; stamps versions and org) |
| **AI client** | `liveAgent.ts` (`callAgent`, `ApiError`, `errorResponse`), `liveAgent.types.ts` (**generated**, never edit by hand), `aiAssist.ts` |
| **Usage and plans** | `usage.ts` (token usage log), `packages.ts` (what each package allows, code fallback), `packages-server.ts` (the `packages` table), `policies.ts` (`checkEntitlement`, one function per business rule) |
| **Organisations** | `permissions.ts` (role → permissions map), `authz.ts` (`can`, `canViewMember`), `orgSettings.ts`, `orgAdmin.ts`, `invites.ts`, `orgInvites.ts`, `orgMembership.ts`, `orgPractice.ts`, `orgCohorts.ts`, `orgDashboard.ts`, `orgAnalytics.ts` (pure: what an admin may see at each share level) |
| **Content** | `packs.ts` (built-in rounds and personas), `domains/` (one file per field), `catalog.ts`, `catalog-server.ts` (Supabase copy, 5-minute cache, code fallback) |
| **Pure business logic** | `recommend.ts` (next best action), `analysis.ts` (filler words, pacing, score bands) |
| **Browser helpers** | `useSpeech.ts` (speech in and out), `dialogContext.tsx` (`useConfirm`, `usePrompt`), `notesContext.tsx`, `notes.ts`, `cortex.ts`, `nav.ts`, `theme.ts` |

Files say at the top whether they are **server-only** or **client-safe**. Keep it that way: anything that imports `supabase.ts` must never reach the browser.

## `liveAgent/`

```
liveAgent/
  live_agent/
    main.py        FastAPI app
    models.py      the API contract (Pydantic) → openapi.json → lib/liveAgent.types.ts
    prompts.py     every prompt, and PROMPT_VERSIONS
    limits.py      LIMITS: how much of each input reaches the model
    gemini.py      the only module that calls the Gemini SDK (generate_json), usage records
    scoring.py     rules applied after the model scores (coverage, "Too short", verdict follows score)
    routes/        interview.py, packs.py, roadmap.py, assist.py, health.py
  tests/           pytest; Gemini always mocked; fixtures/prompts.json holds the prompt goldens
  evals/report/    scoring eval cases (cases/) and run results (results/)
  scripts/         export_openapi.py, eval_report.py, measure_tokens.py
  openapi.json     generated contract, committed
  Dockerfile, railway.json, pyproject.toml
```

Endpoints: `POST /v1/interview/turn`, `/v1/interview/report`, `/v1/packs/generate`, `/v1/roadmap`, `/v1/assist`, `GET /v1/health/models`, and the public `GET /healthz`. Details in [liveAgent/README.md](../liveAgent/README.md).

## `supabase/`

Migrations run in date order:

| Migration | Adds |
|---|---|
| `20261003120000_catalog` | `domains`, `packs` (the catalog) |
| `20261014120000_accounts` | `users`, `profiles`, `consents` |
| `20261019120000_usage_ledger` | `usage_ledger` |
| `20261019130000_packages` | `packages` (allowances, editable without a deploy) |
| `20261019140000_user_collections` | sessions, reports, roadmaps, stories, settings, custom packs, notes, binders, Cortex pages |
| `20261019150000_session_versions` | Server-only version columns on sessions |
| `20261019160000_organizations` | Org tables and their row-level security |
| `20261019170000_join_org` | `join_org()`: the atomic join with the seat check |
| `20261019180000_org_usage` | Org usage totals |

`supabase/tests/` holds the row-level security tests. `supabase/templates/otp.html` is the sign-in email. Local Supabase uses ports 553xx (`config.toml`), because Windows with Hyper-V reserves the default 543xx.

## `mobile/`

An Expo app with exactly one screen: `src/components/WebAppView.tsx`, a WebView of the web app. It adds `OfferlyApp/<version>` to the user agent so the web app can hide Google sign-in (Google blocks it in WebViews). New features go in the web app, not here. Speech-to-text doesn't work inside the WebView yet. See [mobile/README.md](../mobile/README.md).

## Where does my change go?

| I want to... | Change | Also |
|---|---|---|
| Add or change a page | `app/<route>/page.tsx`, shared bits in `components/` | Update USER_FLOW.md |
| Add an AI feature | A route in `liveAgent/live_agent/routes/`, its models in `models.py`, its prompt in `prompts.py`; a thin Core route in `app/api/` that calls `callAgent` | `npm run agent:types`; a prompt golden; SPEC.md |
| Change a prompt | `liveAgent/live_agent/prompts.py` | Update its golden in `tests/fixtures/prompts.json` and bump its `PROMPT_VERSIONS` entry. For the scoring prompt, run `npm run agent:eval` |
| Change how much input reaches the model | `liveAgent/live_agent/limits.py` | Never slice prompt inputs with a literal number |
| Add an interview round | `lib/packs.ts` (code copy), then `npm run db:seed` or edit the `packs` table | |
| Add a field (profession) | A new file in `lib/domains/` | `npm run db:seed` |
| Store a new kind of user data | A table in a new migration, add it to `USER_COLLECTIONS` in `lib/userData.ts`, a collection in `lib/db.ts` | RLS test in `supabase/tests/` |
| Add a request body | A Zod schema in `lib/schemas.ts`, read with `parseBody` | SPEC.md |
| Add an org action | A permission in `lib/permissions.ts`, check it with `can()` in `lib/authz.ts` | Never check a role name in code |
| Add a usage limit | A meter in `lib/packages.ts` / the `packages` table, checked through `lib/policies.ts` | Never check a package name in code |
| Add a setting | A default in `DEFAULT_SETTINGS` | Old saved settings must keep working |
| Ask the user to confirm | `useConfirm()` / `usePrompt()` | Never `window.confirm/alert/prompt` |

## Rules of the codebase

- No Gemini calls outside `liveAgent/live_agent/gemini.py`, and no hardcoded model ids. Models are config (`MODELS` plus env vars).
- The interviewer's system prompt stays identical for a whole session. Anything that changes per turn (time left, questions asked, code) goes in the state note on the newest message.
- Routes return `{ error }` with a status code (plus `issues` on a 400). Keep that shape.
- All persistence goes through `db.*`. Pages never call `fetch("/api/db/...")` themselves.
- Code checks **permissions and entitlements, never role or plan names** (D15). Business rules each live in one function.
- Lists that will grow (roles, kinds, statuses) are validated strings in code, not database enums.
- An org admin never reads members' data through row-level security. Org routes check `can()`, read with the secret key, cut the data to the share level, and write `audit_logs` for sensitive views.
- `lib/liveAgent.types.ts` and `liveAgent/openapi.json` are generated. CI fails if they are stale.

## Environment variables

Core reads `.env.local` (template: `.env.example`); liveAgent reads `liveAgent/.env` (template: `liveAgent/.env.example`).

| Variable | Where | What |
|---|---|---|
| `LIVE_AGENT_URL`, `LIVE_AGENT_TOKEN` | Core | How Core reaches liveAgent; the token must match liveAgent's |
| `GEMINI_API_KEY`, `LIVE_AGENT_TOKEN` | liveAgent | Gemini access; the shared token |
| `GEMINI_CHAT_MODEL`, `GEMINI_SCORING_MODEL`, `GEMINI_REPORT_THINKING` | liveAgent | Optional model and thinking overrides |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Core | Database and accounts. URL + publishable key turn sign-in on |
| `AUTH_MODE`, `AUTH_GOOGLE` | Core | `off` = one local user (refused in production); `on` shows Google |
| `BETA_ALLOWED_EMAILS`, `BLOCKED_EMAIL_DOMAINS` | Core | Who may sign in |
| `SUPER_ADMIN_EMAILS` | Core | Who may open `/admin/orgs` |
| `PACKAGE_DEFAULT` | Core | Package everyone is on (default `beta`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Core | Shared rate-limit counts; in memory without them |

## Deploy (demo)

Two Railway services in one project, region Singapore: `core` (repo root, public at https://build-score.com) and `liveagent` (`liveAgent/Dockerfile`, private network only). `scripts/railway-push-env.ps1` copies local secrets to Railway without printing them. Details in [FLOWS.md § 6](../FLOWS.md#6-deploy-demo).
