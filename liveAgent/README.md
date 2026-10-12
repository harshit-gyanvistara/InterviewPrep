# liveAgent — Offerly's AI service

Python (FastAPI + Pydantic + `google-genai`). It runs every AI feature: the interviewer's turns,
report scoring, generating rounds from a job description, the prep roadmap and the notes writing
assist. Core (the Next.js app at the repo root) is its only caller.

```
Browser ──► Core /api/* ──Bearer LIVE_AGENT_TOKEN──► liveAgent /v1/* ──► Gemini
```

- **Stateless.** No database and no user storage. Core resolves the candidate's field and the
  interviewer persona and sends them with each request.
- **Private.** Every `/v1/*` route needs `Authorization: Bearer $LIVE_AGENT_TOKEN`. `GET /healthz`
  is the only public route (liveness, no Gemini call).
- **Errors** are `{"error": "..."}` with an HTTP status, the same shape the browser already handles.

## Run

From the repo root: `npm run agent:setup` once, then `npm run agent` (port 8000, reloads on change).
By hand:

```bash
cd liveAgent
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"   # .venv/bin/python on macOS/Linux
cp .env.example .env                                                       # GEMINI_API_KEY, LIVE_AGENT_TOKEN
.venv/Scripts/python -m uvicorn live_agent.main:app --reload --port 8000 --env-file .env
```

API docs at http://localhost:8000/docs while it runs.

## Endpoints

| liveAgent | Called by Core route | Model |
|---|---|---|
| `POST /v1/interview/turn` | `/api/interview/turn` | chat |
| `POST /v1/interview/report` | `/api/interview/report` | scoring |
| `POST /v1/packs/generate` | `/api/pack/generate` | scoring |
| `POST /v1/roadmap` | `/api/roadmap` | chat |
| `POST /v1/assist` | `/api/ai/assist` | chat |
| `GET /v1/health/models` | `/api/health` | both |

## Layout

- `live_agent/models.py`: the API contract (Pydantic). Source of truth for `openapi.json` and the
  Next.js app's generated `lib/liveAgent.types.ts`.
- `live_agent/prompts.py`: every prompt. Byte-identical to the TypeScript originals; the interviewer
  prompt is Gemini's cached prefix, so drift costs money.
- `live_agent/gemini.py`: the only module that calls the Gemini SDK (`generate_json`), and logs one
  `llm.usage` JSON line per call.
- `live_agent/routes/`: one module per feature.

## Changing things

- **A prompt:** edit `prompts.py`, then update that case's `expected` text in
  `tests/fixtures/prompts.json` in the same change. `tests/test_prompts.py` fails on any unplanned
  difference.
- **A request or response shape:** edit `models.py` or a route, then run `npm run agent:types` from
  the repo root and commit both `openapi.json` and `lib/liveAgent.types.ts`.
- **Tests:** `npm run agent:test` (Gemini is mocked; no key needed).

## Deploy

The `Dockerfile` serves on `$PORT` (Cloud Run style). Supply `GEMINI_API_KEY` and `LIVE_AGENT_TOKEN`
as platform secrets, then set Core's `LIVE_AGENT_URL` and `LIVE_AGENT_TOKEN` to match.

## Next

The LiveKit + Gemini Live voice agent will join this service as a second entrypoint (see
`DEV_PLAN.md` §3). The cache, dataset and tuned-model router in
`plans/llm-cache-distill-router.md` belongs in `live_agent/llm/`, wrapping `generate_json`.
