# Plan: Split into Core + liveAgent (Python AI service)

**Status: done (2026-10-04)** for the text endpoints. Voice and the follow-ups below are open.

## Context
Offerly is going web + mobile (Android first). Both clients need one backend, and AI work has
different needs from the rest (Python ML ecosystem, LiveKit Agents for voice, long-running calls,
its own scaling and cost controls). So the system is now **two services**:

- **Core**: the Next.js app at the repo root. UI, `/api/*` for web (and later mobile), data, catalog,
  and later auth, quotas, billing, orgs.
- **liveAgent**: `liveAgent/`, Python (FastAPI + Pydantic v2 + `google-genai`). All prompts, all
  Gemini calls, later the voice agent and the [cache/tuned-model router](llm-cache-distill-router.md).

Decisions: Python (matches DEV_PLAN's LiveKit Agents worker and the eval/tuning tooling); folder in
this repo, not a separate repo, so one change can update the contract and both sides; text endpoints
first, voice later.

## Boundaries
| Core keeps | liveAgent owns |
|---|---|
| `lib/domains/` (catalog seed, onboarding `inferDomain`, `resolveDomain`), `lib/catalog-server.ts`, `lib/packs.ts` (`PERSONAS`, `isValidPack`), `lib/types.ts` | `live_agent/gemini.py` (was `lib/gemini.ts`), `live_agent/prompts.py` (was `lib/prompts.ts` + the prompts inline in the routes), response schemas |
| Resolves field + persona and sends them **in the request** | Stateless: no database, no user storage |
| The only public entry point | Private: `/v1/*` needs `Authorization: Bearer LIVE_AGENT_TOKEN` |

Rules that keep the split clean:
1. Clients never call liveAgent directly. Auth, quotas and cost accounting stay in one place (Core).
2. liveAgent never reads the database. Core sends the resolved `DomainIn` and `PersonaIn`.
3. One contract: Pydantic models in `live_agent/models.py` → `liveAgent/openapi.json` →
   `lib/liveAgent.types.ts` (`npm run agent:types`).
4. Browser URLs and response shapes did not change, so no page or component changed.

## Endpoint mapping
| Core route (unchanged for the browser) | liveAgent |
|---|---|
| `POST /api/interview/turn` | `POST /v1/interview/turn` |
| `POST /api/interview/report` (`maxDuration` 120) | `POST /v1/interview/report` |
| `POST /api/pack/generate` (`maxDuration` 120) | `POST /v1/packs/generate` |
| `POST /api/roadmap` | `POST /v1/roadmap` |
| `POST /api/ai/assist` | `POST /v1/assist` |
| `GET /api/health` | `GET /v1/health/models` |
| `GET /api/catalog` | stays in Core |
| — | `GET /healthz` (public liveness) |

## How the port was kept safe
- Before deleting the TypeScript, every prompt builder was rendered for 40 input combinations (each
  persona, coding vs not, Quick Mock budget, pressure, empty/long resume and JD, history windows,
  .5 rounding edges) into `liveAgent/tests/fixtures/prompts.json`. `tests/test_prompts.py` asserts the
  Python output is byte-identical. The interviewer prompt is Gemini's cached prefix, so drift costs money.
- `tests/test_routes.py` (Gemini mocked): auth, validation → 400, error passthrough, `overall`
  clamping/rounding, packs capped at 3, weeks clamped, digests sent as `JSON.stringify` output.
- Verified end to end against real Gemini through Core: health, assist, turn, report, pack
  generation, roadmap; and the "liveAgent down" path (503 with a clear message).

## Running it
`npm run agent:setup` once, then `npm run agent` (port 8000) next to `npm run dev`. Env:
`.env.local` has `LIVE_AGENT_URL` + `LIVE_AGENT_TOKEN`; `liveAgent/.env` has `GEMINI_API_KEY` + the
same token. See [liveAgent/README.md](../liveAgent/README.md).

## Follow-ups (not done)
- **Voice:** LiveKit Agents + Gemini Live worker as a second liveAgent entrypoint; Core issues
  LiveKit room tokens. Changes the interview room UI.
- **`/api/v1` on Core** + user auth and quotas (implementationPlan M1/M2) before mobile ships.
- **Async jobs** for report scoring and pack generation (queue + callback to Core) once they're slow.
- **Deploy:** liveAgent on Cloud Run (asia-south1), replace the shared token with Cloud Run IAM
  service-to-service auth; Core on Vercel.
- **Core route tests** with `callAgent` mocked (M1.6).
- **CI:** run `npm run agent:test`, and fail if `openapi.json` / `lib/liveAgent.types.ts` are stale.
