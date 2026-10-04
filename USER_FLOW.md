# USER FLOW, APP FLOW & SETTINGS SPEC v1

Source of truth for the web app in [web/](web/). Every screen below maps to a route.

## 1. The core loop
**Prepare → Practice → Review → Improve → (repeat) → Land.**
The dashboard's job is to always answer one question: *"What should I do next?"*

## 2. User journey (first-time user)

```
/welcome (landing)
   │  CTA "Start free"
   ▼
/onboarding  (5 steps, resumable, skippable where noted)
   1 About you        name, experience level
   2 Your goal        target role, field (auto-detected from role, or pick one), target companies, interview date (optional), weekly goal
   3 Resume           paste text (skippable, can add later)
   4 Device check     mic, speaker, camera, speech-recognition support (non-blocking)
   5 Ready            summary + "Take your baseline mock" (recommended) or "Go to dashboard"
   ▼
/  Dashboard  ── next-best-action card ──► /practice?pack=…
   ▼
/practice  Choose round → persona → duration → pressure   (settings defaults pre-filled)
   ▼
/interview/[id]  LOBBY  (status: lobby)
   briefing "what to expect", tips for this round, device check, Join / Cancel
   ▼  Join
/interview/[id]  ROOM   (status: active)
   interviewer speaks → you answer (voice or text) → follow-ups → time wrap-up
   End early → confirm → score;   Timer ends → auto-end → score
   ▼
Scoring overlay (status: scoring)  →  on failure: retry, session preserved
   ▼
/report/[sessionId]  (status: done)
   score, rubric, fixes, answer review, next steps
   ▼
Next steps: retry same round │ practice recommended round │ update roadmap │ dashboard
```

## 3. Returning user
- `/` shows: in-progress session (resume) → else next best action.
- Weekly goal ring, streak, interview countdown, readiness, weakest area.
- Progress: trend chart, weakest areas, filterable history, delete sessions.
- Prepare: AI roadmap (weekly checklist) and STAR Story Bank.

## 4. Screen inventory
| Route | Purpose | Gate |
|---|---|---|
| /welcome | Landing, value prop, how it works | Public; onboarded users redirect to / |
| /onboarding | 5-step wizard | Public; onboarded users may revisit to edit |
| / | Dashboard, next best action | Requires onboarding |
| /practice | Configure a mock | Requires onboarding |
| /interview/[id] | Lobby → Room → Scoring | Requires session |
| /report/[id] | Report + next steps | Requires report |
| /progress | Trends, weak areas, history | Requires onboarding |
| /prepare | Roadmap + Story bank | Requires onboarding |
| /settings | Profile, Interview, Voice & audio, Appearance, Data & AI | Requires onboarding |

**Route guard:** no profile with `onboarded: true` → redirect to /welcome (except /welcome and /onboarding).

## 5. Session state machine
`lobby → active → scoring → done`
- `lobby → (cancel)` deletes the session.
- `active → scoring` on End, auto-end (duration + 45 s) or interviewer's closing.
- `scoring → active` if scoring fails (transcript preserved, retry).
- `active` with 0 candidate answers on End → session discarded (nothing to score).
- Refreshing during `active` resumes the same session and transcript; the clock keeps running from the original start.

## 6. Next-best-action rules (dashboard)
1. Session in `active` with messages → **Resume interview**.
2. No completed mocks → a pack generated from the profile's job description if one exists, else the **Behavioural Interview** baseline.
3. Interview date within 14 days → banner "N days to go" and prefer the round matching target companies.
4. Else weakest rubric area across the last 3 reports → mapped round:
   - code / complexity / testing → Live Coding
   - technical / depth / correctness → CS Fundamentals
   - clarity / attitude / company → Mass-Hiring HR
   - ownership / structure / specifics → Leadership Principles
   - otherwise → the round practised least recently.
5. Weekly goal not met → progress ring "2 of 3 mocks this week".

## 7. Features by area (what is built now)
**Onboarding:** wizard with validation, device check, baseline recommendation.
**Practice:** a role-agnostic built-in library (Behavioural, HR Screen, Ownership & Leadership, Case Study, Group Discussion, plus field rounds shown only for that field: two CS rounds for software, and Clinical Viva, MMI Ethics and PG/Residency Selection for medicine) and rounds generated from the user's own job description for any profession, 3 personas, duration, pressure mode, recommended badge.
**Lobby:** briefing, per-round tips, mic/speaker/camera check, join.
**Room:** AI interviewer (spoken + captions), voice or text answers, camera tile, timer, code editor (coding round), transcript, end-confirm, auto-end, retry on errors.
**Report:** score, verdict, rubric with quoted evidence, top fixes, per-answer review with stronger answer, filler-word signals, next steps.
**Progress:** trend, weakest areas, filter by round, delete sessions.
**Prepare:** roadmap generator and checklist; Story Bank (STAR stories with tags).
**Settings & Data:** see below.

## 8. Settings
| Section | Options | Default |
|---|---|---|
| Profile | name, target role, field, target companies, experience, resume, interview date, weekly goal | — / auto-detect / 3 per week |
| Interview | default persona, default duration, pressure mode default, show timer, confirm before ending | neutral / pack default / off / on / on |
| Voice & audio | spoken interviewer on/off, auto-listen after interviewer speaks, interviewer voice, speech speed, recognition language (en-IN, en-US, en-GB), live captions on/off, camera on at join | on / on / auto / 1.0 / en-IN / on / off |
| Appearance | light / dark | light |
| Data & AI | export JSON, import JSON, delete all data, AI connection test (shows model and latency) | — |

## 9. Edge cases handled
- Browser without speech recognition → text answers, clear notice.
- Mic/camera denied → continue text-only.
- API key missing or wrong model → error with Retry; session preserved.
- Refresh mid-interview → resumes.
- Empty interview → discarded, not scored.
- Duplicate opening turn guarded (StrictMode).
- Local storage failure → app renders, writes logged.

## 10. Not built yet (next)
Real accounts and database, Gemini Live voice, human mocks, peer mocks, job tracker, college dashboard, email reminders.
