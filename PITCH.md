# PITCH v0.1 — "Prepare. Practice. Land the job."

Working name: **TBD** (candidates: Offerly, Roundup, DryRun, FirstRound). Status: draft for founder review. Nothing here is final.

---

## 1. One-liner
The one-stop platform where graduates **prepare** (personalised roadmap), **practice** (mock interviews that feel like the real thing: live AI interviewer, video, pressure, panel, real company formats) and **land** (job matching, applications, offer negotiation).

## 2. The problem
- Entry-level market is brutal. New-grad (22–27) unemployment is ~5.6–5.7% vs ~4.2–4.3% overall in the US, and has sat above the national rate since 2021. Applications per posting are up ~26–30% while campus listings are down ~15% YoY (Handshake data via secondary sources).
- Employers are automating screening: ~63% of job seekers report already facing an AI interviewer, and 38% walked away from one (Greenhouse survey). ~21% of US orgs use gen-AI for initial interviews.
- Graduates have **no realistic place to practice**. Pramp is peer-only and mostly coding. Interviewing.io is expensive and FAANG-focused. Chatbot-style AI tools ask questions but don't reproduce pressure, format, or the interviewer's behaviour.
- Prep is fragmented: LeetCode + YouTube + resume tool + job board + Reddit + friends.

## 3. Insight (our wedge)
Everyone sells *question banks + feedback*. Nobody nails **environment fidelity**: the thing that actually makes people freeze. Our wedge is a simulator, not a Q&A bot.

**Fidelity dimensions we will engineer:**
| Dimension | What "real" means |
|---|---|
| Voice/video | Low-latency (<800ms) spoken conversation, interruptions, follow-ups, silence handling |
| Interviewer personas | Friendly HR, skeptical tech lead, rushed hiring manager, panel of 3 |
| Company formats | TCS/Infosys NQT, Amazon Leadership Principles, Google-style coding, consulting cases, bank/finance rounds |
| Platform realism | Zoom/Meet-like UI, HireVue/AI-interviewer-style async recorded questions with countdown timers |
| Live coding/whiteboard | In-browser IDE + run tests, or design canvas, while talking |
| Pressure | Time limits, no retakes mode, camera on, curveballs, "why?" chains |
| Follow-up depth | Probing on *your* resume and *your* previous answer |
| Scoring | Rubric-based (structure, evidence, communication, technical correctness), calibrated against human raters |
| Body/voice signals | Eye contact, pace, filler words, tone (coaching only, never a hiring score) |

## 4. Target users
**Primary (v1):** final-year and recent graduates.
Recommended beachhead: **CS/IT/engineering graduates** (largest, most structured interview loops, easiest to score objectively, paying pain point).
**Expand in order:** business/finance/consulting → non-tech (HR, marketing, ops) → masters/MBA → career switchers.

Geography suggestion: **India first** (huge fresher volume, mass-hiring drives by service companies, price-sensitive but large; existing players like PlaceMate, MockExperts, PlacementDo, ClavePrep are mostly shallow AI Q&A), then US/UK/Gulf. *Decision needed — see §14.*

## 5. Product: three pillars

### A. PREPARE
- Onboarding: target role, company list, timeline, resume upload → **skill-gap diagnosis** via a 20-minute baseline mock.
- Personalised **week-by-week roadmap** (DSA, CS fundamentals, aptitude, behavioural, domain).
- Learning content: short lessons, curated problem sets, company-tagged question banks, aptitude/verbal/logic tests.
- Resume + LinkedIn + GitHub review tuned to ATS and to how the AI screeners read them.
- Story bank builder (STAR stories mapped to common behavioural questions).
- Progress dashboard, streaks, readiness score per target company.

### B. PRACTICE (the core, where the money is)
1. **Live AI mock interview** (voice + video), persona and company selectable, adaptive difficulty.
2. **Async AI-interview simulator** (recorded answers, timed) matching what employers now use.
3. **Coding round**: shared IDE, test runner, interviewer sees your keystrokes and asks about them.
4. **System design / case / whiteboard** canvas rounds.
5. **Group discussion and panel** simulations (multi-agent interviewers).
6. **Human mock marketplace**: verified engineers/managers do paid live mocks (higher price tier, also trains our scoring).
7. **Peer mocks** (free, matched by role) for liquidity and community.
8. **Post-interview report**: transcript, timestamped feedback, model answer comparison, drill-down "redo this answer", trend over time.
9. **Full day simulation** ("Interview Day"): OA → tech 1 → tech 2 → HR back-to-back with a single verdict.

### C. LAND
- Job/internship feed filtered by readiness match (aggregated + direct employer listings).
- Application tracker (kanban), reminders, follow-up email drafts.
- Referral requests helper, alumni network.
- Offer analyser and negotiation coach (CTC breakdown, counter scripts).
- Employer side later: verified "interview-ready" candidate pool (see §9).

## 6. Differentiation vs competitors
| Player | Strength | Gap we exploit |
|---|---|---|
| Interviewing.io | Real engineers, credibility | Expensive, FAANG-only, no end-to-end journey |
| Pramp | Free peer practice | Inconsistent partner quality, coding only |
| Final Round AI / Verve AI | Live copilot during real interviews | Ethically grey, employers cracking down, not skill-building |
| Google Interview Warmup | Free, trusted | Very light, no depth or company formats |
| Big Interview, Yoodli | Behavioural/communication coaching | No technical rounds |
| Exponent | PM/design content | Niche roles |
| Indian fresher tools (PlaceMate, MockExperts, PlacementDo, ClavePrep) | Local, cheap | Mostly chat-style Q&A, limited realism, no landing pillar |

**Positioning:** *We train you; we don't cheat for you.* Copilot-during-interview tools are a growing reputational and legal risk (employers banning/detecting). We stay on the right side and market that.

## 7. Technical architecture (one-person-buildable)
- **Frontend:** Next.js + Tailwind, WebRTC for video, Monaco editor, tldraw for whiteboard. Design language per the dashboard mock you shared (soft glass, dark pill nav, Speaking/Progress/Courses tabs, room chat).
- **Realtime voice:** managed realtime speech-to-speech/LLM API (e.g. LiveKit Agents or Pipecat + STT/LLM/TTS) to avoid building audio infra.
- **Interview brain:** LLM orchestrator with a per-round state machine (question plan → follow-up policy → time control → rubric scoring). Company/role "interview packs" as structured config, not prompts alone.
- **Scoring:** rubric prompts + human-labelled calibration set (start with 200–300 human-rated answers), inter-rater checks, regression tests on every prompt change.
- **Signals:** on-device/browser vision for eye contact and posture, audio analysis for pace and fillers. Privacy-first: process locally where possible, opt-in storage.
- **Backend:** Postgres, object storage for recordings, queue for report generation, auth (Clerk/Auth.js), payments (Stripe + Razorpay).
- **Cost control:** the biggest risk. Estimated variable cost of a 30-min voice mock must be measured early; target <$0.60–1.00 per session via model routing (cheap model for chatter, strong model for scoring), caching, and text-mode fallback. *(Unverified estimate — validate in week 1 spike.)*

## 8. Business model
- **Free:** 2 mocks/month, baseline diagnosis, basic reports (acquisition).
- **Pro ($12–15/mo US; ₹299–499/mo India):** unlimited AI mocks, all company packs, full reports, resume tools.
- **Sprint pass:** 30-day intensive, one-time (converts best near placement season).
- **Human mocks:** $30–80 per session, 25–30% take.
- **B2B2C: colleges/training institutes** license (per-student per-year), placement cell dashboards. Best channel in India.
- **Employer pool / recruiter access** (year 2+): candidates who opt in; paid by hiring companies.

## 9. Go-to-market (solo-founder realistic)
1. Build in public; ship the AI mock for **one role (SDE fresher) + one company format** in ~6–8 weeks.
2. Seed with 100 users from college communities, Reddit, Discord, LinkedIn, WhatsApp placement groups.
3. Content engine: "I got grilled by an AI as a TCS interviewer" clips, shareable score cards.
4. Campus ambassadors with referral credits.
5. Sell 3–5 college pilots (free semester) to get case studies.
6. SEO: company-specific interview question pages, funnel into mock.
Viral loop: shareable "Interview Readiness Score" and invite-a-friend for a peer mock.

## 9b. Success metrics
- Activation: % completing first mock within 24h (target >50%).
- Retention: users doing ≥3 mocks in 14 days.
- **Outcome metric:** self-reported and verified offers per cohort. This is our real proof and marketing asset.
- Score improvement between mock 1 and mock 5.
- Cost per mock vs revenue per user.

## 10. Roadmap
| Phase | Weeks | Scope |
|---|---|---|
| 0 | 1–2 | Cost/latency spike, 20 user interviews, landing page + waitlist |
| 1 MVP | 3–8 | Voice AI interviewer (behavioural + tech Q&A), report, auth, payments, one persona |
| 2 | 9–16 | Coding round, async HireVue-style sim, company packs, roadmap + readiness score |
| 3 | 17–28 | Panel/GD, human marketplace, resume tools, job tracker, college dashboard |
| 4 | 29+ | Job matching, employer pool, more verticals/geographies |

## 11. Risks and honest concerns
1. **Unit economics:** realtime voice AI is costly; free tier can bleed cash.
2. **Commoditisation:** big labs and Google can ship "good enough" mock interviews. Moat must be fidelity, data on outcomes, college distribution, and community.
3. **Scoring credibility:** if feedback feels generic or wrong, trust dies. Needs human-calibration investment.
4. **Graduates have low willingness to pay**, especially in India. B2B2C is likely the real revenue.
5. **Seasonality:** placement seasons spike and crash.
6. **Privacy/compliance:** video and voice of students; consent, retention limits, GDPR/DPDP Act, minors (under-18s excluded).
7. **Scope creep:** "one-stop" is the vision, but shipping all three pillars solo will kill you. Practice first; Prepare and Land come later.
8. **Bias/fairness** in AI scoring of accents and appearance: don't score on those, coach only.

## 12. Other ideas (as you asked)
- **Narrow to a vertical first** rather than "all graduates": SDE freshers in India, then widen. Broad positioning hurts early conversion.
- **Interview "flight recorder"**: users upload real interview recordings/notes after actual interviews; we build a private database of what companies actually ask (crowdsourced, like Glassdoor but structured), a data moat.
- **Employer-side twist:** sell "verified practice-interviewed" profiles; interviews are already recorded and scored.
- **Accessibility angle:** non-native English speakers, neurodivergent candidates, and anxiety-focused practice mode with gradual pressure ramp. Underserved and loyal.
- **Cohort/accountability mode:** groups of 5 preparing for the same company, weekly challenges.

## 13. Research sources (from this session's search)
- [Best AI mock interview platforms 2026 (Revarta)](https://www.revarta.com/blog/best-ai-mock-interview-platforms-2026)
- [Big Interview vs Pramp vs Interviewing.io](https://bestjobsearchapps.com/articles/en/big-interview-vs-pramp-vs-interviewingio-ultimate-mock-interview-platform-comparison-2026)
- [13 Best AI Mock Interview Tools 2026 (FavTutor)](https://favtutor.com/best-ai-mock-interview-tools-2026/)
- [Greenhouse: 63% of job seekers have faced an AI interview](https://www.greenhouse.com/newsroom/63-of-job-seekers-have-faced-an-ai-interview-most-havent-had-a-good-one-yet)
- [CNBC: Your AI interviewer will see you now (Sep 2026)](https://www.cnbc.com/2026/09/16/your-ai-interviewer-will-see-you-now-what-job-seekers-should-know-about-new-hiring-tech.html)
- [IBISWorld: 2026 job market and new grads](https://www.ibisworld.com/blog/2026-job-market-leaves-new-grads-behind/1/1126/)
- [Metaintro: class of 2026 unemployment](https://www.metaintro.com/blog/class-of-2026-unemployment-crisis-new-grad-job-market)
- India fresher tools: [PlaceMate](https://placemate.in/), [MockExperts](https://www.mockexperts.com/mock-interview-for-freshers-india), [SalaryBox roundup](https://salarybox.in/8-best-platforms-for-campus-hiring-and-exam-preparation-in-india-2026/)

**Caveat:** market-size (TAM) figures were not found in this pass, and several stats come from secondary blog sources. Verify before using in any investor material. Cost estimates in §7 are my assumptions.

## 14. Decisions I need from you
1. **Geography first:** India, US, or both?
2. **Beachhead:** SDE freshers only, or all graduates from day one (not recommended)?
3. **Revenue lead:** direct-to-student subscription, or college B2B first?
4. **Build order:** confirm Practice → Prepare → Land.
5. **Name** shortlist and any brand direction beyond the dashboard image.
6. Budget for API costs and timeline you're aiming for (weeks to first paying user).

Once these are answered I'll turn this into a full technical spec (data model, API, interview-engine design, screen-by-screen UI matched to your dashboard).
