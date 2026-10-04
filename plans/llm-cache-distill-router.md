# Plan: Cache → Distill → Tuned-Gemini Router for Offerly

> **Update (2026-10-04):** all AI code moved into the Python service `liveAgent/` ([plan](live-agent-service.md)). Read `lib/gemini.ts::generateJson` below as `liveAgent/live_agent/gemini.py::generate_json`, `lib/prompts.ts` as `live_agent/prompts.py`, and build `lib/llm/` as the Python package `liveAgent/live_agent/llm/` (Next's `after()` becomes FastAPI background tasks). The six Core routes no longer change; the liveAgent routes do.

## Context
Every AI call in Offerly goes to Gemini (Flash for chat/roadmap/assist, Pro for scoring/pack-gen) through one function, `generateJson` in [lib/gemini.ts](../lib/gemini.ts). The idea: **record every prompt→response pair, use that record to fine-tune a cheaper Gemini model, run the tuned model in shadow mode next to the real one, and only promote it (with Gemini as fallback) once it's proven.** Goal: lower cost/latency per mock without losing interviewer or scoring quality.

User choices: own model = **tuned cheaper Gemini tier (Vertex AI)**; rollout = **shadow mode first**; deliverable = **full build plan**; scope = my recommendation (below).

## Feasibility verdict
**Technically feasible and low-risk; economically worth it only at volume.**

| Question | Answer |
|---|---|
| Can we capture training data? | Yes. `generateJson` is the only SDK call site, so one wrapper captures everything. Vertex tuning takes JSONL of `systemInstruction + contents → response`, which is exactly what we log. |
| Legal: training on Gemini outputs? | Tuning a **Google** model on Gemini outputs avoids the "using outputs to build a competing model" problem you'd have with a Llama/Qwen distill. **But** the data contains resumes and transcripts (PII), so we need explicit consent (DPDP/GDPR) before using user data for training (ties to implementationPlan M2.8). |
| Will an exact-match "cache" hit often? | **Mostly no.** `interview/turn` and `interview/report` include the resume, full transcript and elapsed time, so the hit rate is ~0%. Only `pack/generate` (same role+JD) and repeated `ai/assist` calls might hit. The "cache" is really a **dataset**, not a speed layer. |
| Cheaper win available now? | Yes: **Gemini context caching** on the long, repeated system prompts. Reorder `interviewerSystem` so static parts (persona, pack, rules) come first and dynamic parts (elapsed time, code) come last, which maximizes implicit prefix-cache discounts (verify current model support in Gemini docs). |
| Do we have enough data? | **Not today.** It's a single-user prototype with no traffic. Tuning needs ~500–5,000 good examples per task. Bootstrap with **synthetic data**: simulated candidates (strong, weak, rambling, injection-attempt) talking to Gemini Pro, which overlaps implementationPlan M4.4. |
| Where's the money? | The biggest saving is `report` (Pro → tuned Flash/Flash-Lite), but that's also the highest-trust task. `turn` is already on Flash, so the saving there is small per call but it's the highest volume. Break-even ≈ (tuning cost + eval cost) ÷ (per-call saving × calls/month), to be measured in Phase 0. |
| Unverified assumptions | Which current Gemini models support supervised tuning on Vertex; tuned-model inference pricing; min/max dataset sizes. Check Vertex docs at Phase 2 start. |

## Scope recommendation (long run)
**Build it inside Offerly as a self-contained module (`lib/llm/`) with no Offerly imports, so it can be pulled out later.** Don't start as a standalone gateway product: that market is crowded (LiteLLM, Portkey, Helicone, OpenRouter, GPTCache, NotDiamond-style routers) and has no edge without real traffic. Offerly gives real data and a real quality bar. If shadow results turn out strong, extract `lib/llm/` into a package later.

## Architecture
```
route.ts ──► llm.generate({ task, model, system, turns, schema, temperature })
                │
                ├─ cache.lookup(task, hash)        (only allowlisted tasks, TTL)
                ├─ policy[task].mode:
                │    "gemini"   → Gemini only (today's behavior)
                │    "shadow"   → Gemini answers user; after() calls tuned model, logs both
                │    "primary"  → tuned model first; fallback to Gemini on error/timeout/
                │                 schema-invalid/validator fail
                ├─ provider: gemini (API key) | vertex (tuned endpoint)  — both via @google/genai
                └─ after(): log.write({ task, inputHash, input, output, model, usage, ms,
                                        promptVersion, shadow?: {output, usage, ms} })
```
- `after` from `next/server` (confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`) runs shadow calls and logging **after** the response is sent, so users see no added latency.
- `@google/genai` supports Vertex mode (`new GoogleGenAI({ vertexai: true, project, location })`), so one SDK covers both providers.
- Shadow is **sampled** (`sampleRate`, e.g. 0.2) to cap the extra cost.

## Phases

### Phase 0: Instrument & measure (≈1 week)
- Refactor [lib/gemini.ts](../lib/gemini.ts): keep `generateJson` as the single SDK call, return `{ data, usage, ms }` internally (covers implementationPlan M1.4), and fix the stale `web/.env.local` message.
- New `lib/llm/` module: `index.ts` (`generate`), `policy.ts` (per-task config from env/JSON, all `"gemini"` at first), `log.ts` (sink interface; JSONL in `.llm-logs/` for dev, GCS bucket later), `hash.ts` (stable hash of model+system+turns+schema+temperature), `cache.ts` (in-memory/Upstash exact-match, allowlist: `pack/generate`, `ai/assist`; never `health`, `turn`, `report`).
- Each of the 6 routes in `app/api/**/route.ts` calls `llm.generate({ task: "interview.turn" | "interview.report" | "pack.generate" | "roadmap" | "ai.assist" | "health", ... })` instead of `generateJson`. Health bypasses logging.
- Add `PROMPT_VERSION` constants in [lib/prompts.ts](../lib/prompts.ts) and reorder `interviewerSystem` so static content comes first (context-caching win).
- **Output:** a cost/latency table per task, real cache hit rate, and a break-even estimate. **Go/no-go gate.**

### Phase 1: Dataset (≈1–2 weeks, needs consent)
- Consent toggle in Settings ("Help improve Offerly's AI", default **off**); the client sends a flag and the logger drops non-consented rows. Redact emails and phone numbers from resumes.
- `scripts/synth-sessions.ts`: simulated candidate personas × each built-in pack in [lib/packs.ts](../lib/packs.ts), driven against Gemini Pro, logged via the same path. This is the main data source pre-launch.
- `scripts/build-dataset.ts`: logs → per-task Vertex JSONL (train/validation split, dedupe by hash, drop errors and very short outputs), uploaded to GCS.

### Phase 2: Tune (≈1 week per task)
- Start with **`interview.turn`** (highest volume, lowest stakes per call), then `roadmap` / `pack.generate`. **`interview.report` goes last.**
- Vertex supervised tuning on the cheapest tunable Flash-tier model; record the tuned endpoint ID in `policy.ts` and a `docs/adr/` note.
- New env vars: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, service-account creds; add them to `.env.example`.

### Phase 3: Shadow evaluation (≈2–4 weeks running)
- Set `mode: "shadow"` per task. `lib/llm/compare.ts` computes per-task metrics on each logged pair:
  - `interview.turn`: schema validity, `endInterview` agreement, LLM-judge pairwise preference (Gemini Pro, blind A/B), reply length ratio.
  - `interview.report`: |overall Δ| (MAE), verdict agreement, per-dimension correlation (target ≥0.7, same bar as DEV_PLAN scoring calibration).
  - `pack.generate` / `roadmap`: schema validity + judge score.
- `scripts/shadow-report.ts` prints a scorecard per task with promotion thresholds, e.g. turn: judge win-or-tie ≥ 45% and 0 schema failures over ≥500 samples.

### Phase 4: Promote with fallback
- `mode: "primary"` per task once its thresholds pass. Fall back to Gemini on: timeout (e.g. 4s for turn), SDK error, JSON/schema failure (Zod from implementationPlan M1.1), or cheap validators (empty reply, `overall` out of range).
- Keep a 5–10% Gemini **holdout** that keeps producing fresh training and eval data, and log fallback rate as the health metric (alert if > 5%).

### Phase 5: Retraining loop
- Monthly (or whenever prompt version changes): rebuild the dataset from new consented and holdout data, retune, then shadow → promote. A prompt-version change automatically resets that task to `"shadow"`.

## Dependencies on existing plan ([implementationPlan.md](../implementationPlan.md))
- M1.1 Zod schemas → needed for Phase 4 fallback validation.
- M1.4 usage capture → done as part of Phase 0.
- M2 DB + privacy → durable logs and consent. Until then, JSONL/GCS logging is fine for synthetic data and the dev user.
- M4.4 eval harness → shares the simulated-candidate code with Phase 1 synth data.

## Critical files
- Modify: [lib/gemini.ts](../lib/gemini.ts), [lib/prompts.ts](../lib/prompts.ts), all 6 `app/api/**/route.ts`, `lib/types.ts` (Settings consent field + `DEFAULT_SETTINGS`), Settings page (consent toggle), [SPEC.md](../SPEC.md) §3/§5.
- New: `lib/llm/{index,policy,log,hash,cache,compare}.ts`, `scripts/{synth-sessions,build-dataset,shadow-report}.ts`, `.env.example`, `docs/adr/00X-llm-router.md`.

## Risks
| Risk | Mitigation |
|---|---|
| Tuned model sounds generic or degrades interviewer realism (the product's differentiator) | Turn task gated on blind judge preference; human spot checks of 50 transcripts before promote |
| Scoring drift erodes trust | Report promoted last, with strict correlation gate and permanent holdout |
| PII in training data | Consent default off, redaction, Vertex India region, retention limit on logs |
| Too little data | Synthetic bootstrap; don't tune a task with < 500 clean examples |
| Savings smaller than eval/tuning cost | Phase 0 break-even gate; can stop after Phase 0 and keep the logging and context-caching wins |
| Gemini model deprecations invalidate tuned models | Model IDs in `policy.ts`; retraining loop; fallback always available |

## Verification
- Phase 0: `npm run lint && npx tsc --noEmit`; run a full mock in the app and confirm `.llm-logs/*.jsonl` has one row per call with usage and ms; confirm Settings → AI connection test still works; repeat a `pack/generate` request and see a cache hit in the logs.
- Unit tests (Vitest, per M0.3): `hash.ts` stability, `cache.ts` allowlist (turn/report never cached), policy fallback logic with a mocked provider that times out or returns bad JSON.
- Phase 3: `scripts/shadow-report.ts` on logged data produces the per-task scorecard. User-facing responses are byte-identical to Gemini-only mode, and response latency is unchanged (shadow runs in `after`).
- Phase 4: force tuned-model errors (bad endpoint ID) and confirm a transparent fallback to Gemini with the fallback logged.
