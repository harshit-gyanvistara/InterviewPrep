# Features

What Offerly does today, who it's for, and what isn't built yet. Screen-by-screen detail is in [USER_FLOW.md](../USER_FLOW.md); the reasons behind each choice are in [DECISIONS.md](../DECISIONS.md).

**Status key:** ✅ built · 🟡 partly built · ⏳ planned

## Who it's for

- **Candidates:** final-year students and recent graduates first, in any profession. The product started with software and medicine and has a general field for everyone else.
- **Organisations:** colleges, companies, coaching institutes and bootcamps that give Offerly to their people for learning and mock practice. Employer screening of applicants is out of scope.

The product loop is **Prepare → Practice → Review → Improve → repeat**. The dashboard always answers one question: *what should I do next?*

---

## For candidates

### Accounts and sign-in ✅
- Sign in with a 6-digit code sent by email, on the web and in the app. The email also has a sign-in link that works in the browser that asked for it.
- "Continue with Google" on the web only. It's hidden in the mobile app, because Google blocks sign-in inside WebViews.
- Temporary inboxes (yopmail, mailinator and about 5,000 others) can't sign in.
- Private beta: only emails on the invite list (`BETA_ALLOWED_EMAILS`) can sign in and use AI.
- Delete account removes everything. Continuing at sign-in means agreeing to the terms (recorded as a consent).

### Onboarding ✅
Five steps, resumable: about you → your goal (role, field, target companies, interview date, weekly goal) → resume (optional) → device check (mic, speaker, camera, speech support) → ready (take a baseline mock or go to the dashboard).

### Dashboard ✅
- **Next best action:** resume an unfinished interview; else a baseline mock; else the round that fixes the weakest skill from the last 3 reports; open org assignments come first.
- Weekly goal ring, streak, days until the interview date, readiness, weakest area, mocks left today.

### Practice ✅
- **Built-in rounds:** Behavioural, HR Screen, Ownership & Leadership, Case Study, Group Discussion for everyone; CS Fundamentals and Live Coding for software; Clinical Viva, MMI Ethics and PG/Residency Selection for medicine.
- **Rounds from a job description:** paste a JD and AI builds 2–3 rounds for that job, in any profession.
- **Quick Mock:** mix topics from several rounds into one short mock with a set number of questions.
- Choose the interviewer persona (friendly, neutral, tough), duration and pressure mode. Settings fill in the defaults.

### The interview ✅
- **Lobby:** what to expect, tips for the round, device check, join or cancel.
- **Room:** the AI interviewer speaks (text-to-speech) and shows captions. Answer by voice (speech-to-text in Chrome, Edge, Safari) or by typing. Camera tile, timer, a code box for coding rounds, the transcript.
- The interviewer follows up on your answers and your resume, and wraps up when time runs out.
- End early with a confirm, or it ends itself at the time limit plus 45 seconds, or when the interviewer closes.
- Refresh mid-interview and it resumes with the clock still running. A dropped connection doesn't lose answers (saves are queued and retried).

### The report ✅
- Overall score and verdict, a score for each rubric skill with quoted evidence from your answers, strengths and top 3 fixes.
- Each answer reviewed, with a stronger version of your answer and a model answer.
- Filler words and pacing (counted in the browser, no AI).
- **Honest scoring:** skills the interview gave no evidence for are marked "not assessed" instead of guessed. An interview with fewer than 3 real answers is "Too short to score": no number, and left out of averages and charts.
- Next steps: retry the round, try the recommended one, update the roadmap.

### Progress ✅
Score trend chart, weakest areas, history filtered by round, delete sessions.

### Prepare ✅
- **Roadmap:** AI writes a week-by-week prep plan from your profile and recent reports, as a checklist.
- **Story bank:** STAR stories with tags, for behavioural questions.

### Notes and Cortex ✅
- **Quick notes:** a drawer on every page (press `n` or the floating button). Notes can be attached to an interview, a report, a round and so on.
- **Cortex:** a rich-text notebook (binders → pages) with headings, lists, checklists, code and links.
- Both have AI writing help (improve or generate).

### Settings ✅
Profile, interview defaults, voice and audio (voice on/off, auto-listen, voice, speed, recognition language, captions, camera), appearance (light/dark), organisations (change sharing, leave), data and AI (account, export/import JSON, delete all data, AI connection test).

### Mobile app 🟡
An Android (and iOS) app that wraps the web app in a WebView, with native back button and camera/mic permissions. Speech-to-text doesn't work inside the app yet (WebViews lack the browser speech API), so answers there are typed.

---

## For organisations

### Setting up an org (Offerly staff) ✅
Super-admins (`SUPER_ADMIN_EMAILS`) create an org at `/admin/orgs`: name, address (slug), kind, owner email. They set the org's plan as entitlement rows (seats, mocks per day/month/year, any other key) and settings, with no SQL. Marketing owns plans and sets them per deal. Every change is audited.

### Members and invites ✅
- Owners and admins invite by email (one single-use link each; paste a CSV for many) or create a reusable join code like `K7QM4-XR2PD`, optionally limited to email domains.
- The seat limit is enforced at the moment of joining, even when two people take the last seat at once.
- Someone who opens an invite while signed out signs in and comes straight back to it.
- Roles: owner, admin, coach, member. Owners alone manage owners; the last owner can't leave or be demoted.

### Privacy: the member decides ✅
On joining, each member chooses what the org may see: **activity** (mocks taken and when), **scores** (plus results and weak skills) or **full** (plus transcripts). They can change it or leave from Settings at any time; it takes effect at once. Their history stays theirs. Practice done as yourself is never visible to an org.

### Practising for an org ✅
A "Practising for" switcher in the top bar. In org mode, `/practice` shows the org's allowed rounds and mocks count against the org's plan, not the member's own allowance. The server checks membership and stamps the org on the session once, on its first AI call.

### Cohorts and assignments ✅
Admins create cohorts (e.g. "CSE 2026") and place members in them. Admins and coaches assign a round to everyone or to one cohort, with an optional due date and a number of mocks each. Only completed, scored reports count toward an assignment. Overdue work stays listed until done.

### Admin dashboard ✅
`/org/<slug>`: overview (seats, mocks against plan, assignment completion, members quiet for 7+ days), members (roles, removal, sharing level, mocks, last practice, readiness where shared), analytics by cohort, audit log, CSV export. Group score figures show only when at least 3 members share scores. Opening a member's detail and exporting are audited.

### Org rounds in /practice 🟡
Org-authored rounds aren't built. Orgs choose from the built-in rounds today.

---

## Platform features (what makes the above safe)

| Feature | Status | What it does |
|---|---|---|
| Request validation | ✅ | Every API body checked by a Zod schema; 400 with field errors, 413 over 1 MB |
| Rate limits | ✅ | Per user (per IP when signed out) on every AI and sign-in route; Upstash Redis when configured |
| Usage allowances | ✅ | Each user's package (everyone on `beta`: 5 mocks and 150 AI calls a day, reset at midnight IST). Limits live in a `packages` table and change without a deploy |
| Usage and cost tracking | ✅ | Every Gemini call is measured (tokens, thinking tokens, failures) and logged against the user and request |
| History on the server | ✅ | Every kind of user data in Supabase, own rows only (row-level security); older browser data uploaded once on first sign-in |
| Trusted interview context | ✅ | Signed in, the server loads the transcript, profile and pack itself; the browser can't swap what gets scored |
| Session versioning | ✅ | Each session records the exact round used and the prompt, rubric and model versions, so old reports can be explained |
| Field profiles | ✅ | General, software and medical shape the prompts and which rounds show; adding a field is one file |
| Catalog in the database | ✅ | Fields and built-in rounds live in Supabase, with the code copy as seed and fallback |
| Demo deploy | ✅ | https://build-score.com on Railway; liveAgent on a private network. Demo only, not for real users yet |
| Error tracking | ⏳ | Sentry or similar (at rollout) |
| Privacy work | ⏳ | Consent copy, retention policy, data export on request (at rollout) |

---

## Not built yet

| Area | What | Milestone |
|---|---|---|
| Interview engine | Explicit interview phases, a follow-up policy (probe, challenge, hint, move on), running summary for long interviews | M4 |
| Scoring trust | Simulated-candidate eval harness in CI, 100+ human-rated answers for calibration, "Was this fair?" on reports | M4 |
| Realistic voice | Gemini Live speech-to-speech with interruptions, under 1.8 s response time | M3 (spike first, can be cancelled) |
| Coding round | Monaco editor, a sandbox to run code and tests, a problems bank | M5 |
| Business | Free/Pro tiers, Razorpay/Stripe checkout, reminder emails, analytics, shareable readiness card | M6 |
| Later | Org SSO, white-label, LMS links, async recorded-answer interviews, panels/group discussion with several AI interviewers, human mock marketplace, peer mocks, job tracker, job matching | Later |

Full order and status: [ROADMAP.md](ROADMAP.md).
