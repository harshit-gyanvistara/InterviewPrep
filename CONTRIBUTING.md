# Contributing to Offerly

Start with [implementationPlan.md](implementationPlan.md). It explains how the system works today, what we build next and in what order, and lists good first tasks (Part 5).

## Setup

Follow [README.md § Run](README.md#run). You need Node 22+ and Python 3.12+. Without Supabase keys in `.env.local`, `npm run dev` runs with sign-in turned off (one local user), which is fine for most work. To work on sign-in or server data, run a local Supabase (`npx supabase start`, needs Docker) and put its URL and keys in `.env.local`.

## Before you open a PR

```bash
npm run lint
npm run typecheck
npm test            # Vitest; `npm run coverage` for the coverage report
npm run build
npm run agent:test  # if you touched liveAgent/
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of these on every PR. It also fails if `liveAgent/openapi.json` or `lib/liveAgent.types.ts` is out of date; fix that with `npm run agent:types`.

## Tests

- Unit tests sit next to the code as `lib/<name>.test.ts` and run in Node (no DOM). Start with pure logic: `lib/recommend.ts`, `lib/analysis.ts` and `lib/packs.ts` must stay at 80%+ line coverage (CI enforces this in [vitest.config.mts](vitest.config.mts)). Add files to `coverage.include` there as you test them.
- Pin the clock with `vi.useFakeTimers()` + `vi.setSystemTime()` for anything date-based.
- Route tests import the route module and call its handler (see `lib/api.contract.test.ts`, `lib/auth.test.ts`). Supabase is faked at the client level there; row-level security is tested against a real local database in `supabase/tests/` (skipped unless `SUPABASE_TEST_URL` is set; CI's `database` job sets it).
- liveAgent tests are pytest in `liveAgent/tests/`. Gemini is always mocked; prompts are checked against goldens in `tests/fixtures/prompts.json`.

## Definition of done

Every PR meets these (the PR template has them as a checklist):

- Lint, typecheck, tests and build pass.
- If `lib/types.ts` or a route's request/response shape changed, [SPEC.md](SPEC.md) is updated in the same PR.
- No Gemini SDK calls outside `liveAgent/live_agent/gemini.py`; no hardcoded model ids. A prompt change updates its golden; a contract change re-runs `npm run agent:types`.
- No `window.confirm/alert/prompt`; use `useConfirm()` / `usePrompt()`.
- User-visible behaviour changes are reflected in [USER_FLOW.md](USER_FLOW.md).

## Next.js version

This repo uses Next.js 16, which has breaking changes from most tutorials. Read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers, middleware, caching or config (see [AGENTS.md](AGENTS.md)).
