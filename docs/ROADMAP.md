# Roadmap and long-term plans

Where each milestone stands, what we build next, and where the product is heading. The detailed task list with exit gates is [implementationPlan.md Part 4](../implementationPlan.md#part-4--milestones); each initiative has its own file in [plans/](../plans/).

*Status as of 2026-10-24.*

## Where we are

| Milestone | Goal | Status |
|---|---|---|
| **M0** Team-ready repo | Clone, run, green CI on the first change | ✅ Done (2026-10-05) |
| **M1** Harden the API | Safe to deploy as a public demo | ✅ Done except M1.5 error tracking (moved to rollout). Demo live at https://build-score.com |
| **M2** Accounts and server data | Real users, history on every device | ✅ Mostly done: sign-in, all user data on the server, versioned sessions, server-trusted context, solo end-to-end test. Open: M2.7 explicit "import my local data" upload, M2.8 privacy (at rollout) |
| **M2-Org** Organisations | A college or company can give Offerly to its people | ✅ O.1–O.6 built; end-to-end and database tests green locally. Open: org rounds in `/practice` (O.7) |
| **M3** Realistic voice | The interviewer sounds and reacts like a person | ⏳ Not started; begins with a go/no-go spike |
| **M4** Interview engine and trusted scoring | Better interviews, scores you can trust | 🟡 Started: report eval set (M4.0) built; the report and turns run with low thinking to cut cost |
| **M5** Coding round | Real editor and code execution | ⏳ Not started |
| **M6** Business and growth | Sign up, hit the free limit, pay, continue | ⏳ Not started (usage limits by package already built, ahead of plan) |

One gap to close soon: CI ([ci.yml](../.github/workflows/ci.yml)) runs on pull requests and on pushes to `main`, and the work so far is pushed to `proposal-1` only, so **no green CI run on GitHub has been confirmed yet**. Everything above is green locally.

## Order of work

```
M0 ─► M1 ─► M2 ─┬─► M2-Org ─────────────────┐
                ├─► M3 (spike gates build) ─┤
                ├─► M4 ─────────────────────┼─► M6 ─► Later
                └─► M5 ─────────────────────┘
```

M2-Org, M3, M4 and M5 all depend on M2 and not on each other, so they can run in parallel with a team of three.

**Current focus (owner's call, 2026-10-24): the product, M4.** The live deploy stays a demo, and production readiness waits for rollout.

## Next up: M4, the interview engine and scoring

| Task | What | Why it matters |
|---|---|---|
| M4.1 Orchestrator | Explicit phases `intro → warmup → question loop → candidate questions → wrap-up`, tracked on the server; the prompt gets the current phase and remaining topics | Today one prompt decides pacing and ending by itself |
| M4.2 Follow-up policy | A quick check of each answer picks probe, challenge, hint or move on, by persona and time left | Follow-up depth is what makes a mock feel real |
| M4.3 Context summary | A running summary plus recent turns instead of the last 60 messages | Long interviews silently drop early history today |
| M4.4 Eval harness | Simulated candidates (strong, weak, evasive, rambling, prompt-injection) run against each round, checking flow, timing and scores. In CI on prompt or round changes, nightly in full | Stops quality regressions |
| M4.5 Calibration set | 100+ human-rated answers; target ≥ 0.7 correlation per skill | Scores must match what a human would give |
| M4.6 Report feedback | "Was this fair?" on each report | Real disagreements feed the eval set |

What we already know from M4.0 ([plans/report-eval-set.md](../plans/report-eval-set.md)): the scorer passes 8 of 9 seed cases and is a little harsh on average answers (mean signed error around -0.6 to -1.1 points). A calibration step is added only if the error grows past about ±5 points.

## Rollout checklist

Done once, before the first real users ([DECISIONS.md, 2026-10-24](../DECISIONS.md)):

- [ ] Own SMTP for sign-in emails, and the Supabase email templates
- [ ] Upstash Redis variables on the deploy, so rate limits are shared across instances
- [ ] Error tracking (M1.5)
- [ ] Privacy (M2.8): consent copy, retention policy, delete-all and data export on request
- [ ] A production smoke test
- [ ] A green CI run on GitHub (run it on `proposal-1`, or merge to `main`)
- [ ] Decide when to replace the beta invite list with packages (M6)

## After M4

### M3: Realistic voice (spike first, can be cancelled)
A one-week spike: LiveKit + Gemini Live speech-to-speech. Measure response time from India (target p95 ≤ 1.8 s), interruptions, session length limits and cost per 30-minute mock. Go → a voice worker inside liveAgent, LiveKit room UI with the text path as fallback, transcript written to the session so scoring is unchanged, reconnect after a drop. No-go → improve browser speech and move on.

### M5: Coding round
Monaco editor with a language picker, a Judge0 sandbox behind `/api/code/run` (CPU, memory and time caps, no network), a problems table tagged by topic and company, run results visible to the interviewer and scorer. Exit: 80% of started coding rounds finish; median run under 3 s.

### M6: Business and growth
Free and Pro tiers enforced from the usage ledger (the mechanism exists), Razorpay and Stripe checkout with webhooks, reminder emails tied to the weekly goal and interview date, product analytics, a shareable readiness card.

## Long-term plans

### AI cost: cache → distil → tuned model ([plans/llm-cache-distill-router.md](../plans/llm-cache-distill-router.md))
Record prompt and response pairs (with user consent), fine-tune a cheaper Gemini model on them, run it in shadow next to the real one, and promote it per task only when it matches, with Gemini as fallback. Order: interview turns first, the report last. Worth it only at volume, so it waits for real traffic. Phase 0 (measure) is partly done: `npm run agent:measure` showed thinking tokens were the biggest cost, which led to low thinking.

### Organisations beyond M2-Org ([plans/organisations.md](../plans/organisations.md))
Rounds written by the org, field profiles per org, sign-in by Google Workspace or Microsoft domain, then SAML/SCIM, white-label, LMS integrations and self-serve org billing.

### The pitch's three pillars ([PITCH.md](../PITCH.md))
Practice comes first, and is what's being built. Then:
- **Prepare:** skill-gap diagnosis from a baseline mock, lessons and question banks by company, resume and LinkedIn review, readiness score per target company.
- **More practice formats:** async recorded-answer interviews (like HireVue), system design and case canvases, panels and group discussions with several AI interviewers, a full "interview day", a human mock marketplace, peer mocks.
- **Land:** job and internship feed matched to readiness, application tracker, referral help, offer analysis and negotiation coaching, later an opt-in pool for employers.

### Target architecture ([DEV_PLAN.md](../DEV_PLAN.md))
DEV_PLAN describes a larger system (separate Node API, Redis, job queues, object storage for recordings). We grow toward it only when a feature needs it (decision D1): voice needs the agent worker, coding needs a sandbox, slow reports would need a queue.

## Open questions for the owner

These are deliberately deferred. The code is built so that each answer becomes configuration, not a rewrite (D15).

| Question | Where it plugs in |
|---|---|
| Geography first (India, US, both), beachhead, product name, budget | PITCH §14 |
| Is realistic voice a must for launch, or is browser speech enough for the first paying users? | M3 go/no-go |
| Hosting: stay on Railway (Singapore) or move to an India region for latency or data residency? | Deploy |
| Keep, grow or freeze Cortex and Notes? | Not in the pitch |
| Store raw audio at all, or transcripts and derived signals only? | M3, privacy |
| Under-18 members in orgs (needs parental consent) | Consent rows (D15) |
| Org pricing: per seat, per mock, or a pool of minutes | Entitlement rows; owned by marketing |
| Employer screening mode | Out of scope until decided |
