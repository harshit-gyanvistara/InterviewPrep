## What and why

<!-- One or two sentences. Link the milestone task from implementationPlan.md (e.g. M1.1) or the plan in plans/. -->

## How I tested it

<!-- Unit tests, and/or the manual steps you ran in the app. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass (CI runs them too)
- [ ] Touched liveAgent? `npm run agent:test` passes
- [ ] Changed `lib/types.ts` or a route's request/response shape → updated [SPEC.md](../SPEC.md)
- [ ] Changed liveAgent models or routes → ran `npm run agent:types` and committed `openapi.json` + `lib/liveAgent.types.ts`
- [ ] Changed a prompt → updated its golden in `liveAgent/tests/fixtures/prompts.json`
- [ ] Changed what the user sees → updated [USER_FLOW.md](../USER_FLOW.md)
- [ ] No Gemini calls outside `liveAgent/live_agent/gemini.py`, no hardcoded model ids
- [ ] No `window.confirm/alert/prompt` (use `useConfirm()` / `usePrompt()`)
