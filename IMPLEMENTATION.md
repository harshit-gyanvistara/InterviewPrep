# IMPLEMENTATION v1 — What's actually built

Companion to [PITCH.md](PITCH.md) (vision), [DEV_PLAN.md](DEV_PLAN.md) (target architecture/roadmap) and [USER_FLOW.md](USER_FLOW.md) (UX flow). This document describes the **current** code in this repo (Next.js app at the repo root, AI service in [liveAgent/](liveAgent/)) as it exists today, not the target architecture. For the full data model and API contracts, see [SPEC.md](SPEC.md).

**Status: client-side prototype.** There is no auth, no database, and no realtime voice infra yet — this is a single-user, browser-local app that proves out the interview-engine prompts, scoring, and UX end to end using Gemini's text API, ahead of building the production stack described in DEV_PLAN.md.

---

## 1. Stack

| Layer | What's actually used |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Rich text | Tiptap (`@tiptap/react` + starter-kit, task-list, underline, link, placeholder extensions) — used by Cortex and Notes |
| Icons | lucide-react |
| AI | Separate Python service **liveAgent** ([liveAgent/](liveAgent/README.md): FastAPI + Pydantic + `google-genai`) — Gemini text models only (no Live API, no voice model). The Next.js routes proxy to it via `lib/liveAgent.ts` |
| Speech (browser) | Web Speech API (`SpeechRecognition`/`speechSynthesis`) via `lib/useSpeech.ts` — client-side only, no server STT/TTS |
| Storage | `window.localStorage`, wrapped in an async `db` object (`lib/db.ts`) |
| Auth | None — single implicit user per browser |
| Hosting target | Not configured in-repo; runs via `next dev` / `next start` plus `npm run agent`. liveAgent has a Dockerfile (Cloud Run style), no IaC |

Everything in DEV_PLAN.md's architecture diagram (LiveKit, Postgres, Redis, BullMQ, Judge0, Clerk, Razorpay/Stripe, job queues) is **not present**. The `code` editor field in a session is a plain `<textarea>`-style string field, not Monaco, and there is no sandboxed code execution.

## 2. Why it's built this way

The fastest way to validate "is the interviewer prompt realistic and is the scoring trustworthy" without building voice infra, a backend, or billing is to:
1. Keep all durable state in the browser (`localStorage`), so there's no backend to stand up.
2. Replace the planned Gemini **Live** (speech-to-speech) session with **text-mode chat**: the browser does STT/TTS locally via the Web Speech API, and each candidate turn is sent to a stateless Next.js API route that calls Gemini's text-generation endpoint for the interviewer's next line.
3. Score asynchronously via a second Gemini call over the full transcript, using a JSON schema response so the report page can render structured data without parsing free text.

This matches DEV_PLAN.md §11 (solo-founder cut): one persona set, text-first, no recordings, managed services only — except even the "managed services" (LiveKit, Clerk, Postgres) have been deferred in favor of zero infra.

## 3. Request flow for a live interview turn

```
Browser (interview room, client component)
  │ SpeechRecognition → candidate's spoken answer as text (or typed text)
  │ appends Message{role:"candidate"} to in-memory session state
  ▼
POST /app/api/interview/turn  (stateless)
  body: { config, profile, pack, messages, elapsedSec, code }
  │ resolves field + persona, forwards to liveAgent POST /v1/interview/turn
  │   liveAgent: system prompt via prompts.py::interviewer_system()
  │   generate_json() → Gemini MODELS.chat, response_schema TurnResult {reply, endInterview}
  ▼
Browser receives { reply, endInterview }
  │ appends Message{role:"interviewer"}
  │ speechSynthesis speaks `reply` (if voiceReply setting on)
  │ if endInterview → session moves to "scoring"
  ▼
POST /app/api/interview/report  (on end)
  body: { config, profile, pack, messages, code }
  │ resolves field + interviewer name, forwards to liveAgent POST /v1/interview/report
  │   liveAgent: transcript text, system prompt via prompts.py::scoring_system()
  │   generate_json() → Gemini MODELS.scoring, response_schema ReportResult
  ▼
Browser persists Report to db.reports, Session.status = "done"
```

The API routes (and liveAgent behind them) are **stateless** — every call re-sends the full `profile`, `pack`, and recent `messages` from the browser's local state; the server holds no session memory between turns. This is what makes "refresh mid-interview resumes" work for free: the transcript lives in `localStorage`, not server memory.

## 4. The interview engine (what exists instead of an orchestrator)

DEV_PLAN.md describes a state-machine orchestrator (`intro → warmup → question loop → wrap-up`) driving a Live session via function calls. The current implementation has no explicit state machine. It's a single system prompt (`liveAgent/live_agent/prompts.py::interviewer_system`) that stays identical for the whole session, so Gemini can serve it from its prompt cache on every turn. It contains:
- field norms for the candidate's field (`lib/domains`, e.g. how medical vivas and MMI stations run)
- persona tone (`lib/packs.ts::PERSONAS` — friendly/neutral/tough, each with a name and a tone description)
- the pack's topic list, rubric, and style instruction
- an optional question budget for Quick Mock sessions (`SessionConfig.questionCount`)
- the candidate's resume/JD/profile, for grounding follow-ups

What changes per turn (elapsed/remaining time with a wrap-up flag under 90s, questions asked so far, and the code-editor contents for coding rounds) is sent as a `[STATE]` note on the newest candidate message (`interviewState`), never in the system prompt.

The model self-regulates pacing and when to end (`endInterview: boolean` in its structured output) rather than an external state machine deciding. There is no explicit follow-up policy, curveball logic, or interruption mechanism beyond what's described in the prompt text — "probe weak answers, raise difficulty on strong ones" is instruction, not code.

## 5. Interview packs (content config)

Packs (`lib/types.ts::Pack`) are the "interview pack" concept from DEV_PLAN.md, implemented as plain data, not versioned/admin-managed config:
- **Built-in library**: 10 hardcoded packs in `lib/packs.ts` (Behavioural, HR Screen, Ownership & Leadership, Case Study, Group Discussion, CS Fundamentals, Live Coding, Clinical Viva, MMI Ethics, PG/Residency Selection). Field packs list the field ids they are shown for; the field is the one the user picked in their profile, or one guessed from role and JD (`lib/domains::resolveDomain`).
- **Generated packs** (`source: "jd"`): `POST /api/pack/generate` asks Gemini to produce 2–3 rounds tailored to the profile's target role + job description, so any profession (not just software) gets relevant rounds. Persisted to `db.customPacks`.
- **Quick Mock packs** (`source: "quick"`): assembled client-side in `lib/packs.ts::buildMixedPack` by merging topics/rubric from 1+ selected existing packs — no AI call, pure data merge.

No pack versioning, no admin UI, no regression suite — any prompt/pack change is immediate and untracked.

## 6. Scoring

A single Gemini call per completed session (`POST /api/interview/report`) returns the entire `Report` (overall score, verdict, per-dimension scores with evidence quotes, strengths, top 3 fixes, and up to 6 per-question `AnswerReview`s each with a personalized rewrite and a generic "expected answer"). There is no human-rated calibration set, no correlation tracking, and no regression testing on prompt changes — DEV_PLAN.md's scoring-trust requirements (§7, §9b) are not yet implemented.

`lib/analysis.ts::computeSignals` runs client-side, non-AI filler-word/pacing analysis (regex word counts) and is merged into the report display as `Signals`.

## 7. Storage layer (`lib/db.ts`)

A single `db` object exposes async CRUD per collection (`profiles`, `sessions`, `reports`, `roadmaps`, `stories`, `settings`, `customPacks`, `notes`, `binders`, `cortexPages`), backed by `JSON.stringify`'d arrays in `localStorage` under an `interviewprep:v1:` prefix. Writes dispatch a `window` event that a `useQuery` hook subscribes to, giving every component live updates without a global store library. This is intentionally a thin adapter — the comment in the file says the intent is to swap it for `fetch("/api/db/...")` against Postgres later without changing call sites.

Practical implications of this choice:
- **Single-browser, single-user.** No sync across devices; clearing site data loses everything.
- **No real auth.** `Profile.onboarded` is the only gate; anyone with the URL has full access.
- **Export/Import JSON** (Settings → Data & AI) is the only backup/migration mechanism.
- **No server-side validation or ownership checks** on reports/sessions — the API routes trust whatever `profile`/`pack`/`messages` the browser sends.

## 8. Voice & speech

`lib/useSpeech.ts` wraps the browser's native `SpeechRecognition` (continuous, interim results) and `speechSynthesis` for TTS, gated by Settings → Voice & audio (voice on/off, auto-listen, language, speech rate). This is **not** the Gemini Live API from DEV_PLAN.md — there's no low-latency audio-to-audio model, no barge-in handling beyond what the browser's recognizer naturally allows, and recognition quality/availability varies by browser (Chrome/Edge support it; others fall back to text input with a notice, per USER_FLOW.md §9).

## 9. App surface (routes)

See [USER_FLOW.md](USER_FLOW.md) §4 for the full screen inventory and flow. In brief, routes under `app/`:
`/welcome`, `/onboarding`, `/` (dashboard), `/practice`, `/interview/[id]`, `/report/[id]`, `/progress`, `/prepare`, `/settings`, plus two standalone tools not in the original pitch: `/notes` (quick sticky notes with AI assist) and `/cortex` (a binder/page notebook with a Tiptap rich-text editor, also AI-assisted via the shared `/api/ai/assist` endpoint).

## 10. API routes (all stateless, all Gemini-backed)

| Route | Purpose |
|---|---|
| `POST /api/interview/turn` | Next interviewer line + whether to end |
| `POST /api/interview/report` | Full scored report from a transcript |
| `POST /api/pack/generate` | 2–3 JD-tailored interview rounds |
| `POST /api/roadmap` | N-week prep roadmap from profile + recent report digests |
| `POST /api/ai/assist` | Shared "improve" / "generate" HTML writer for Notes and Cortex |
| `GET /api/health` | Connection test (key presence + latency ping to both configured models) used by Settings → Data & AI |

Full request/response shapes are in [SPEC.md](SPEC.md) §5.

## 11. Known gaps vs. the pitch/dev-plan

Explicitly out of scope in the current build (also listed in USER_FLOW.md §10): real accounts/database, Gemini Live voice, video, coding sandbox/execution, human mocks, peer mocks, panels/GD with multiple real participants (the "Group Discussion" pack simulates other voices via one model, per `lib/packs.ts`), job tracker, college/B2B dashboard, payments, email reminders, pack versioning, scoring calibration, and observability/cost tracking.
