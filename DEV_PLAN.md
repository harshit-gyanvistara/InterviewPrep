# DEV PLAN & ROADMAP v0.1 — Interview Simulator Platform

Companion to [PITCH.md](PITCH.md). Audience: engineering team. Status: draft; assumptions in §1 need founder sign-off.

---

## 1. Assumptions (change these and the plan changes)
| # | Assumption | If wrong |
|---|---|---|
| A1 | Beachhead = SDE freshers, India first | Non-tech roles need different rubrics and no coding round; US needs Stripe-only billing, different company packs |
| A2 | Build order = Practice → Prepare → Land | Land-first means a job-feed/aggregation team from month 1 |
| A3 | Team: 1 tech lead/full-stack, 2 full-stack, 1 AI/ML eng, 1 designer (part-time), founder as PM. Scale down = drop phases, not quality | See §11 for solo-founder cut |
| A4 | **All AI via the Gemini API** (Live API for voice, text models for scoring/reports); no self-hosted models in v1 | Self-hosting adds GPU ops and ~2 months; a second vendor is only a fallback |
| A5 | Web only (desktop browsers Chrome/Edge/Safari). Mobile web is view-only for reports | Native apps add ~1 phase |
| A6 | Revenue in v1: B2C subscription; B2B college dashboard in Phase 3 | Colleges-first moves the admin dashboard into Phase 1 |

## 2. Guiding principles
1. **Fidelity is the product.** Latency, interruptions and follow-up quality outrank feature count. Every phase has a fidelity exit criterion.
2. **Cost per session is a first-class metric**, tracked from day one on every session.
3. **Scoring must be trustworthy**: rubric-based, versioned, regression-tested against human-rated data.
4. **Config over prompts**: company/role packs are structured data, not hand-edited prompt strings.
5. **Privacy by default**: opt-in recording, retention limits, deletion on request (India DPDP Act, GDPR-ready).
6. Ship vertical slices; every sprint ends with something a real student can use.

## 3. System architecture

```
Browser (Next.js)
 ├─ WebRTC audio/video ──► LiveKit (SFU)
 ├─ Monaco editor / tldraw canvas ─► Realtime sync (WebSocket)
 └─ REST/tRPC ─► API (Node/TS)

LiveKit ──► Interview Agent Worker (Python, LiveKit Agents Gemini plugin)
             ├─ Gemini Live API (single audio-to-audio session:
             │     speech in → reasoning → speech out, barge-in built in)
             ├─ Interview Orchestrator (state machine + follow-up policy)
             │     drives the Live session via system instructions + tool calls
             └─ Transcript tap (input/output transcription → session_events)

Post-session (queue workers) ──► Gemini text models (Flash / Pro), structured JSON output
             → rubric scoring, report generation, resume parsing, roadmap generation

API ──► Postgres (core data)      ──► Redis (sessions, rate limits, queues)
    ──► Object storage (recordings, transcripts, artifacts)
    ──► Job queue (BullMQ/Celery): report generation, scoring, signal analysis
    ──► Code runner sandbox (Judge0 or Firecracker/gVisor containers)
    ──► Payments (Razorpay + Stripe), Email, Analytics (PostHog), Observability
```

### 3.1 Key components
| Component | Choice (default) | Notes |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind, shadcn/ui | Design system built from the dashboard mock: soft-glass cards, dark pill nav, light/dark toggle |
| Realtime media | LiveKit (cloud first, self-host later if cost demands) | Also gives recording (egress) |
| Voice agent | **Gemini Live API** (`gemini-3.8-live`; `gemini-3.8-live-extended-thinking` for harder rounds) via LiveKit Agents (Python) | One model replaces separate STT + LLM + TTS. Native barge-in, background tool calls mid-speech. Fallback path: Gemini STT → text model → Gemini TTS |
| LLM (text) | **Gemini API** via `google-genai` SDK: Flash-tier for parsing/drafts, Pro-tier for final scoring and reports | Structured output (JSON schema) for rubric scores; thin internal wrapper so the model ID is config, not code |
| Backend API | Node/TypeScript (Fastify or NestJS) + tRPC/OpenAPI | Single deployable monolith until Phase 3 |
| DB | Postgres (+ pgvector for question/answer retrieval) | Prisma or Drizzle |
| Queue | BullMQ (Redis) or Celery if agent code is Python-heavy | Report + scoring jobs are async |
| Code execution | Judge0 (self-hosted) initially | Hard sandbox limits: CPU, memory, no network |
| Auth | Clerk or Auth.js (Google, email, phone OTP for India) | College SSO later |
| Infra | Docker, Terraform, one cloud (AWS/GCP), region close to India users (Mumbai) for latency | Agent workers autoscale on active sessions |
| Observability | OpenTelemetry, Sentry, per-session trace with latency per stage | Non-negotiable for voice |

### 3.2 Interview engine (the core IP)
Each interview = a **Round** built from an **Interview Pack**.

- **Pack (structured config):** company, role, round type, duration, question plan (topic tree with difficulty bands), interviewer persona (tone, strictness, interruption rate), rubric, time rules.
- **Orchestrator state machine:** `intro → warmup → question loop (ask → listen → probe/follow-up → transition) → candidate questions → wrap-up`.
- **Follow-up policy:** decides among *probe deeper*, *challenge*, *hint*, *move on*, *curveball* based on answer quality score, time left, persona.
- **Memory:** running summary of the conversation plus resume facts, so the interviewer can say "you mentioned X on your resume".
- **Time control:** hard clock; interviewer wraps up on schedule.
- **Rubric scorer (async, post-session):** scores each answer on rubric dimensions with quotes as evidence; output is structured JSON, then rendered into the report.
- **Safety layer:** prompt-injection resistance (candidates will try "ignore your instructions"), profanity/abuse handling, no protected-attribute scoring.

Latency: Gemini Live is a single audio-to-audio hop; Google's launch figures quote about 1.18s to first audio for `gemini-3.8-live` (verify in the spike, from an India region). Target stays **p50 ≤ 1.0s, p95 ≤ 1.8s**; if Live misses it, use the fallback pipeline or shorter prompts.

**Gemini-specific notes**
- **Client-side vs server-side:** the API key must never reach the browser. The agent worker holds the key; browsers only talk to LiveKit (or use ephemeral tokens if connecting directly).
- **Session limits:** Live sessions have duration/context limits; use session resumption and context compression for 30–45 min interviews (check current limits in docs).
- **Orchestrator control:** since Live owns the turn-taking, the state machine steers via system instruction updates and function calls (`next_question`, `end_round`, `get_time_left`) rather than a prompt per turn.
- **Transcripts:** enable input/output audio transcription; the scorer works from the transcript, not raw audio.
- **Cost accounting:** log usage metadata from every response into `usage_ledger`.
- **Rate limits/quotas:** free-tier keys are unsuitable for production; use a paid project, request quota increases before beta, and add per-user concurrency caps.
- **Data terms:** paid-tier API data handling differs from free tier; confirm no-training terms before storing student recordings/PII (or use Vertex AI in Google Cloud for enterprise terms and an India region).

### 3.3 Data model (core tables)
`users`, `profiles` (target roles/companies, resume), `organizations` (colleges), `memberships`, `packs`, `pack_versions`, `sessions`, `session_events` (turn-level), `transcripts`, `recordings`, `scores` (per rubric dimension, per answer), `reports`, `roadmaps`, `roadmap_items`, `problems` (coding), `submissions`, `subscriptions`, `usage_ledger` (tokens, audio minutes, cost per session), `human_reviewers`, `bookings`, `feedback_ratings` (user rates report quality), `audit_logs`.

## 4. Roadmap overview

| Phase | Weeks | Theme | Exit gate |
|---|---|---|---|
| 0 | 1–2 | De-risk & foundations | Voice spike hits latency + cost targets; design system + infra ready |
| 1 | 3–10 | **MVP: Voice mock + report** | 100 real users complete a mock; median report-usefulness ≥ 4/5 |
| 2 | 11–20 | Full interview realism | Coding round, async-AI simulator, company packs; 30% pay-conversion of engaged trial users (target) |
| 3 | 21–32 | Prepare + B2B | Roadmap engine, resume tools, college dashboard, 3 paid pilots |
| 4 | 33–44 | Panel/GD, human marketplace, Land | Job tracker, matching v1, human mocks live |
| 5 | 45+ | Scale & expand | New geography/roles, employer pool, mobile |

Dates assume start on Week 1 and a team of 5–6; scale linearly for smaller teams.

## 5. Phase detail

### Phase 0 — De-risk & foundations (Weeks 1–2)
**Goals:** prove feasibility, cost, and latency before building anything else.
- **Voice spike (AI eng + tech lead):** LiveKit + Gemini Live end-to-end; measure p50/p95 latency, barge-in quality, session-length limits and cost per 30-min session for `gemini-3.8-live` vs `-extended-thinking`, plus the STT→text→TTS fallback.
- **Cost model:** from published rates (audio in $0.005/min, audio out $0.018/min, text in $0.75/M, text out $4.50/M tokens; verify on the pricing page) a 30-min mock is roughly **$0.30–0.60** before context re-billing and scoring calls. That is an estimate; the spike replaces it with measured numbers. Drives free-tier limits and pricing.
- **Repo/infra:** monorepo (apps/web, apps/api, apps/agent, packages/ui, packages/config), CI (lint, typecheck, tests), preview envs, IaC, secrets, staging.
- **Design system:** tokens, components, and screens for Landing, Dashboard, Interview Room, Report, based on the dashboard image.
- **Research:** 15–20 student interviews; collect 3 real interview formats (e.g. TCS/Infosys NQT, Amazon-style behavioural, generic SDE tech round) as packs.
- **Legal/privacy:** consent copy, retention policy, DPDP checklist, terms (no minors).
**Exit:** written go/no-go on stack; latency p95 ≤ 2.0s in spike; cost per mock known.

### Phase 1 — MVP: Voice mock + report (Weeks 3–10)
Sprints of 2 weeks (S1–S4).

**S1 (W3–4): Skeleton**
- Auth, onboarding (target role, company, level, resume upload), profile.
- Session lifecycle API (create, join, end), LiveKit room tokens.
- Interview Room UI (video tiles, mic/cam controls, live captions, timer) per mock.
- Agent worker: basic conversation, single persona.

**S2 (W5–6): Real interviewer behaviour**
- Orchestrator state machine + Pack loader (2 packs: Behavioural HR, SDE Tech Q&A).
- Follow-up policy v1, time control, barge-in handling, silence handling.
- Resume parsing → interviewer memory.
- Transcript persistence, recording (opt-in).

**S3 (W7–8): Scoring & report**
- Async rubric scorer, evidence-linked feedback, model-answer suggestions.
- Report page: transcript with timestamped comments, per-dimension scores, top 3 fixes, "retry this question".
- Basic voice signals: pace (WPM), filler words, long pauses.
- Human-rated calibration set v0 (100+ answers rated by 2 raters).

**S4 (W9–10): Business + hardening**
- Free/Pro tiers, usage limits, Razorpay (+ Stripe) billing, invoices.
- Dashboard (past sessions, streak, score trend).
- Analytics events, error handling, network-drop recovery (reconnect resumes interview).
- Load test (see §8), security review, closed beta with 100 users.

**Exit criteria:** 100 completed real sessions; p95 latency ≤ 1.8s; session-failure rate < 3%; report rated ≥ 4/5 by users; cost per mock within target.

### Phase 2 — Full interview realism (Weeks 11–20)
- **Coding round:** Monaco editor, Judge0 runner, curated problem set (≥ 150 problems, tagged by company/topic), interviewer sees code + test results, asks about complexity and edge cases, hint ladder. Copy-paste and tab-switch telemetry as a *coaching* signal only.
- **Async AI-interview simulator:** recorded one-way questions, countdown, no retakes mode, HireVue-style UI.
- **Personas & pressure modes:** friendly / neutral / tough; "stress" mode with interruptions and curveballs.
- **Company packs:** 6–10 packs (service-company mass hiring, product-company behavioural, startup generalist). Pack authoring CLI and admin UI with versioning.
- **Full Interview Day:** chained rounds with an overall verdict.
- **Scoring v2:** calibration vs human ratings (target ≥ 0.7 correlation on core dimensions), prompt regression suite in CI.
- **Vision signals (opt-in):** eye contact, posture, framing—coaching only, on-device where feasible.
- **Growth features:** shareable readiness card, referrals, email lifecycle.
**Exit:** coding round completion ≥ 80% of starts; scoring correlation target met; 30-day retention baseline measured.

### Phase 3 — Prepare + B2B (Weeks 21–32)
- **Diagnosis + roadmap engine:** baseline mock → skill-gap vector → generated weekly plan; adapts to mock results.
- **Learning content:** lessons, aptitude/verbal/logical tests, DSA sheets tied to packs; CMS for content ops.
- **Resume/LinkedIn/GitHub review** and ATS check; STAR story bank.
- **College dashboard (B2B):** org accounts, cohorts, seat licences, placement-cell analytics (readiness by branch, weak topics), CSV export, SSO (Google Workspace / Microsoft).
- **Admin/back-office:** user support tools, pack management, cost dashboards, abuse controls.
- **Accessibility mode:** anxiety-friendly gradual pressure, captions everywhere, keyboard-only navigation, WCAG 2.1 AA pass.
**Exit:** 3 paid college pilots; roadmap users complete ≥ 3 mocks/14 days more often than non-roadmap users.

### Phase 4 — Panels, humans, Land (Weeks 33–44)
- **Panel/GD simulation:** multi-agent interviewers with turn-taking arbitration.
- **Human mock marketplace:** reviewer onboarding/verification, availability/booking, live human interview in the same room with AI-assisted notes, payouts (Razorpay Route / Stripe Connect), ratings. Human ratings feed the scoring calibration set.
- **Peer mocks:** matching by role/level, reputation, no-show handling.
- **Land:** job/internship feed (partner APIs + manual employer listings), readiness-match ranking, application tracker, follow-up email drafts, referral request helper, offer analyser/negotiation coach.
**Exit:** ≥ 500 human sessions completed with rating ≥ 4.3; first verified placements tracked.

### Phase 5 — Scale & expand (Week 45+)
Employer opt-in candidate pool, new verticals (finance/consulting/non-tech), new geographies, native mobile, self-hosted media/model optimisations for cost, public API for colleges.

## 6. Workstreams and ownership (team of 6)
| Stream | Owner | Key deliverables |
|---|---|---|
| Interview engine & agent | AI/ML eng + tech lead | Orchestrator, personas, latency, packs |
| Scoring & evaluation | AI/ML eng | Rubrics, calibration, regression suite, report generation |
| Web app | Full-stack #1 | Onboarding, room UI, dashboard, report UI |
| Platform/API/billing | Full-stack #2 | Auth, sessions, payments, org/admin, queues |
| Infra/DevEx/security | Tech lead (part) | CI/CD, IaC, observability, cost controls, security |
| Design/content | Designer + founder | Design system, pack content, problem sets, copy |

## 7. Engineering standards
- TypeScript strict; Python typed (mypy/pyright); shared schemas via Zod/JSON Schema generated for both.
- Trunk-based dev, PRs < 400 lines, required review, feature flags (PostHog/Unleash) for every user-facing change.
- Test pyramid: unit → contract (API/agent messages) → E2E (Playwright, with fake media devices) → **conversation evals**.
- **Conversation eval harness:** simulated candidates (scripted LLM personas: strong, weak, evasive, rambling, injection-attempt) run against packs; assert on flow, timing, rubric outputs; run nightly and on prompt/pack changes.
- ADRs for major decisions (stack, vendors, data retention).
- Versioning: packs, rubrics, and prompts are versioned; every session stores the versions used so reports are reproducible.

## 8. Non-functional targets
| Area | Target |
|---|---|
| Voice latency | p50 ≤ 1.0s, p95 ≤ 1.8s mouth-to-ear |
| Availability | 99.5% (Phase 1) → 99.9% (Phase 3) |
| Session failure rate | < 3% → < 1% |
| Concurrency | Load-test 500 concurrent sessions before Phase 2 exit, 3,000 before placement season |
| Report turnaround | < 90s after session end |
| Code run | < 3s median for typical tests; sandbox with no network, memory/time caps |
| Cost | Measured per session; alert if 7-day average exceeds budget by 20% |
| Recording security | Encrypted at rest and in transit, signed URLs, default retention 90 days, user-initiated deletion within 24h |

## 9. Security, privacy, compliance
- Consent screens before mic/cam and before recording; separate toggle for using data to improve models (default off).
- PII minimisation; resumes and recordings in isolated buckets; role-based access for staff; audit logs.
- DPDP Act (India), GDPR-ready (DSAR export/delete), age gate 18+.
- Prompt-injection and abuse defences in the agent; rate limits and bot protection on signup and free tier.
- No use of face/voice signals for anything except user-facing coaching; document this publicly.
- Vendor DPAs with LLM/STT/TTS providers; confirm no training on our data.
- Pre-launch pen test (Phase 2 exit) and periodic dependency/SAST scanning.

## 10. Risks & mitigations (engineering view)
| Risk | Mitigation |
|---|---|
| Latency too high in India regions | Phase 0 measurement, regional endpoints, streaming everywhere, fallback to faster model, text-mode fallback |
| Cost per session over budget | Model routing, aggressive prompt/context trimming, caching of packs, session-length caps, free-tier throttling, cost dashboard from week 3 |
| Scoring feels generic or wrong | Human-rated calibration, evidence quotes required, user "was this fair?" feedback loop, regression suite |
| Single-vendor dependence on Gemini (outage, price/model deprecation, preview-model changes) | Model IDs in config, thin wrapper around `google-genai`, fallback STT→text→TTS path, pin model versions, watch deprecation notices, budget alerts on the Google Cloud project |
| Browser/media issues (permissions, Safari, bad networks) | Pre-flight device/network check screen, reconnect logic, low-bandwidth audio-only mode |
| Cheating/abuse of free tier | Phone OTP, device fingerprint limits, usage ledger |
| Scope creep | Phase gates; anything not in the current phase goes to backlog with founder approval |

## 11. Solo-founder / small-team cut (if a full team isn't available)
Team of 1–2: do Phase 0, then Phase 1 with these cuts — one persona, one pack (SDE behavioural + basic tech Q&A), text report only (no signals), Razorpay only, no recordings. Use managed services everywhere (LiveKit Cloud, Clerk, Vercel, managed Postgres). Timeline ≈ 10–12 weeks to closed beta instead of 8. Defer everything after Phase 2 until revenue exists.

## 12. Immediate next steps (first 10 days)
1. Founder answers pitch §14 decisions and signs off assumptions A1–A6.
2. Tech lead: choose vendor shortlist for STT/LLM/TTS; open accounts and budgets.
3. AI eng: build voice spike; publish latency/cost table.
4. Designer: turn the dashboard image into a Figma design system and the 4 core screens.
5. Founder/PM: schedule 15–20 student interviews and collect real interview formats.
6. Tech lead: scaffold monorepo, CI, staging, observability skeleton.
7. Team: write ADR-001 (stack) after spike results; kickoff Sprint 1 planning.

## 13. Open questions for the team
- Does Pipecat or LiveKit Agents give better control over barge-in/turn detection for our case? (Spike output.)
- Judge0 self-hosted vs a managed code-execution service: cost and security trade-off.
- Do we store raw audio at all in v1, or only transcripts + derived signals (cheaper, more private)?
- Which India payment methods to support at launch (UPI, cards, wallets)?
- Who owns pack/content quality long-term (in-house SMEs vs contract interviewers)?
