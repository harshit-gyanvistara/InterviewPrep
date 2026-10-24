# Testing

Every kind of test we have, how to run it, what CI checks, and the testing we still plan to build. Conventions for writing tests are also in [CONTRIBUTING.md § Tests](../CONTRIBUTING.md#tests).

## The layers

| Layer | Tool | Where | What it proves | Needs |
|---|---|---|---|---|
| **Unit** | Vitest (Node, no DOM) | `lib/*.test.ts`, next to the code | Pure logic: recommendations, signals, packs, schemas, permissions, share levels, allowances, rate limits | Nothing |
| **Route and contract** | Vitest | `lib/api.contract.test.ts`, `lib/auth.test.ts`, `lib/route.test.ts`, the `lib/org*.test.ts` files | Real route handlers with liveAgent faked at `fetch` and Supabase faked at the client: auth, 401/403/429, validation, error pass-through, timeouts | Nothing |
| **liveAgent** | pytest | `liveAgent/tests/` | Prompts match their goldens, limits are applied, routes shape responses, scoring rules, usage records. Gemini is always mocked | Python venv (`npm run agent:setup`) |
| **Database** | Vitest against a real local Postgres | `supabase/tests/rls.test.ts`, `supabase/tests/org-rls.test.ts` | Row-level security: no user reads another's rows; org isolation; `join_org` seat limit | Docker + `npx supabase start` |
| **End to end** | Playwright (Chromium) | `e2e/solo.spec.ts`, `e2e/org.spec.ts` | Whole journeys in a real browser against the built app, local Supabase and a stub liveAgent | Docker + local Supabase |
| **Scoring evals** | Python script | `liveAgent/evals/report/` | The **real** Gemini scorer gives scores in the expected range on hand-written transcripts | A Gemini key; costs money |
| **Token measurement** | Python script | `liveAgent/scripts/measure_tokens.py` | Tokens and latency per call in a scripted mock on the real models | A Gemini key; costs money |

Rules that hold in every automated test: **no test calls Gemini** (evals and measurement are manual tools, not tests), and **end-to-end and database tests refuse any database that isn't local**, because they create and delete users.

## Running them

```bash
npm test
```

```bash
npm run coverage
```

```bash
npm run agent:test
```

Database and end-to-end tests need a local Supabase (Docker must be running). In Git Bash:

```bash
npx supabase start
```

```bash
eval "$(npx supabase status -o env)" && export SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_TEST_SECRET_KEY=$SECRET_KEY && npx vitest run supabase/tests && npm run e2e
```

Playwright builds the app into `.next-e2e` (a running `npm run dev` is untouched), starts it on port 3300 and a stub liveAgent on port 8100. Local Supabase uses ports 553xx because Windows with Hyper-V reserves 543xx.

Manual tools against real Gemini (need `GEMINI_API_KEY` in `liveAgent/.env`):

```bash
npm run agent:eval
```

```bash
npm run agent:measure
```

Also before pushing: `npm run lint`, `npm run typecheck`, `npm run build`.

## What CI runs

[.github/workflows/ci.yml](../.github/workflows/ci.yml), on every pull request and every push to `main`. Three jobs:

| Job | Steps |
|---|---|
| **Next.js app** | `npm ci` → lint → typecheck → Vitest with coverage → check `lib/liveAgent.types.ts` matches `openapi.json` → `next build` with no secrets |
| **Supabase** | Start a fresh local Supabase (applies every migration) → row-level security tests → Playwright end-to-end tests; the Playwright report is uploaded if they fail |
| **liveAgent (Python)** | `pip install` → pytest → check `openapi.json` matches the code |

**Coverage gate:** at least 80% line coverage on `recommend.ts`, `analysis.ts`, `packs.ts`, `schemas.ts`, `route.ts`, `rateLimit.ts`, `auth.ts` and `pages.ts` in `lib/` (set in [vitest.config.mts](../vitest.config.mts)). Add files to `coverage.include` there as you test them.

**Drift checks:** CI fails if the generated contract files are stale. Fix with `npm run agent:types` and commit both files.

## What the end-to-end tests cover

**Solo** (`e2e/solo.spec.ts`): a brand-new account goes through the real onboarding, takes a 3-answer text-mode mock, gets the scored report, and finds it on `/progress` and the dashboard. Plus "Not you? Sign out" on onboarding.

**Organisations** (`e2e/org.spec.ts`): a super-admin creates an org with its owner → the owner creates a join code and an assignment → a member joins sharing scores and completes the assignment → the owner sees it on the dashboard and member detail. Then the exit-gate checks:

1. A member of org A can't read org B, and outsiders can't read org A.
2. Members can't open the dashboard; transcripts need the "full" share level.
3. After leaving, a member can't add org practice and the org can't see them.
4. The seat limit blocks the join that would exceed it.
5. An exhausted org quota stops a new org interview (429).

## The scoring eval set

[plans/report-eval-set.md](../plans/report-eval-set.md). Nine hand-written transcripts in `liveAgent/evals/report/cases/` (strong, average and weak answers across behavioural, technical and HR rounds, plus too-short, off-topic and prompt-injection cases). Each has an expected score **range** and allowed verdicts, not an exact score, because the model varies between runs. The runner reports pass/fail per case and the **mean signed error** (positive = too generous, negative = too harsh). Results are saved in `evals/report/results/`.

It isn't in CI (each run is about 9 calls to the Pro model, and a live model is flaky in CI). CI only checks that the case files are valid (`tests/test_evals.py`).

**Run it whenever** you change the scoring prompt, the scoring model, the thinking level or the rules in `scoring.py`, and record the result in the plan.

Latest (2026-10-24): 8 of 9 pass with low thinking, mean signed error -0.6 to -0.8.

## What to test when you change something

| You change | Add or update | Run |
|---|---|---|
| Pure logic in `lib/` | A unit test next to it | `npm test` |
| An API route | A route test (fake liveAgent at `fetch`, Supabase at the client); SPEC.md | `npm test` |
| A request body | A case in `lib/schemas.test.ts` | `npm test` |
| A prompt | Its golden in `liveAgent/tests/fixtures/prompts.json`, and bump its `PROMPT_VERSIONS` entry | `npm run agent:test` |
| The scoring prompt, model or rules | As above | `npm run agent:test`, then `npm run agent:eval` |
| A liveAgent request or response shape | A route test in `test_routes.py` | `npm run agent:types`, `npm run agent:test` |
| A limit in `limits.py` | Nothing extra: `test_limits.py` checks every prompt builder | `npm run agent:test` |
| A migration or RLS policy | A case in `supabase/tests/` | Database tests |
| An org permission or share-level rule | `lib/authz.test.ts` or `lib/orgAnalytics.test.ts`; a database test if RLS is involved | `npm test`, database tests |
| A user journey | The Playwright spec that walks it | `npm run e2e` |
| Anything date-based | Pin the clock with `vi.useFakeTimers()` and `vi.setSystemTime()` | |

## Manual check before a demo

Automated tests use a stub interviewer, so walk the real thing once on the demo build:

1. Sign in with an email code (and Google on the web).
2. Finish onboarding with a pasted resume.
3. Generate rounds from a job description.
4. Take a full mock by voice in Chrome: the interviewer speaks, follows up, and wraps up on time.
5. Refresh mid-interview: it resumes.
6. Read the report: evidence quotes, fixes, stronger answers. Then a one-answer mock shows "Too short to score".
7. Quick Mock, roadmap, a note, a Cortex page.
8. Settings → Data & AI → AI connection test is green.
9. Org: create one at `/admin/orgs`, join with a code in a second browser, do the assignment, check the dashboard.
10. The Android app: sign in with the code, take a typed mock.

## Testing still to build

| Item | What | Milestone |
|---|---|---|
| First CI run on GitHub | Everything is green locally; CI hasn't been confirmed on GitHub | Now |
| Coverage for `lib/domains` | Tests for `inferDomain`, `resolveDomain` and a bad regex coming from the database. A good first task | M0 follow-up |
| Component tests | None yet. Would need jsdom and `@vitejs/plugin-react` in Vitest | When UI logic needs it |
| Client-side validation | The Zod schemas are only used on the server so far | M1.1 follow-up |
| Error tracking | Sentry or similar for routes and the browser | Rollout (M1.5) |
| Production smoke test | A short scripted check on the deploy after each release | Rollout |
| Eval harness | Simulated candidates (strong, weak, evasive, rambling, injection) against every round, checking flow, timing and scores; in CI on prompt or round changes, nightly in full | M4.4 |
| Calibration set | 100+ human-rated answers; correlation ≥ 0.7 per skill. Real transcripts replace the synthetic eval seeds | M4.5 |
| Fairness feedback | "Was this fair?" ratings feed disagreements into the eval set | M4.6 |
| Voice measurements | p50/p95 response time from India, failure rate under 3% over 50 internal mocks, cost per mock | M3 |
| Coding round metrics | 80% of started coding rounds complete; median run under 3 s; sandbox limits tested | M5 |
| Payments | Checkout and webhook tests against the provider's test mode | M6 |
