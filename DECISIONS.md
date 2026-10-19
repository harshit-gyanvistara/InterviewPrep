# Decisions log

Every decision made while building Offerly, newest first: what was decided, why, what else was considered, and when to look at it again. The architecture decisions D1–D15 are in [implementationPlan.md Part 3](implementationPlan.md#part-3--key-technical-decisions); entries here refer to them by id. How the plan changed over time is in [FLOWS.md § Initial plan and deviations](FLOWS.md#initial-plan-and-deviations).

Add an entry in the same commit as the change it describes.

---

## 2026-10-19 · Admin dashboard: share levels applied in one pure module, groups of 3+ (M2-Org O.6)
- **Decision:** All dashboard data comes from rows stamped with the org's `org_id`, read on the server with the secret key after a permission check, and is cut to each member's share level in `lib/orgAnalytics.ts` (activity: mocks and dates; scores: plus results and weak skills; full: plus transcripts). Score figures for a group show only when at least 3 of its members share scores. Viewing a member and exporting CSV are audited. Owners alone change who's an owner, the last owner can't be demoted or removed, and nobody changes their own role or removes themselves here.
- **Why:** One pure module makes "what can an admin see?" testable in one place. The group minimum stops an average of one or two people from exposing their scores. Auditing views makes access visible to the org and to us.
- **Considered:** SQL views per share level (harder to test, logic spread out); showing small-group averages (would reveal individuals); letting admins see solo practice (breaks D11).
- **Revisit:** If orgs need trend charts over time, or exports with per-mock rows.

## 2026-10-19 · Assignments count through stamped reports (M2-Org O.5)
- **Decision:** An assignment is a built-in round for everyone or one cohort, with an optional due date and a number of mocks each. A session counts toward it only if the server stamped `assignment_id` on the first AI call: same org, the member's cohort (or everyone), and the assigned round. Progress is the number of reports carrying that `assignment_id`; "done" means at least the target. Overdue assignments stay listed until done. A coach placed in a cohort can only set work for that cohort.
- **Why:** Counting stamped reports means an assignment can't be completed from the browser, and an unfinished interview doesn't count. Keeping overdue work visible matches how placement cells chase students.
- **Considered:** Letting the client mark progress (forgeable); counting sessions instead of reports (abandoned interviews would count); hiding overdue items (work would silently disappear).
- **Revisit:** When orgs author their own rounds, and if "too short" reports shouldn't count toward an assignment.

## 2026-10-19 · Practising for an org: stamped once by the server, org plan for mocks (M2-Org O.4)
- **Decision:** The "Practising for" choice lives in the user's settings and is copied into a new session's config. The server checks the membership, the "practice" permission and the org's allowed rounds on the session's first AI call, then stamps `sessions.org_id`. After that the column is the truth: a session never moves between orgs, and a session that started solo stays solo. Reports get `org_id`/`assignment_id` copied from their session when saved; the browser can't set them. Org practice checks the org's `mocks` entitlement (summed over `usage_ledger.org_id` by `usage_total_org`, day/month/year/none). No `mocks` row means no limit. The per-user `ai_calls` guard still applies. A user's own `usage_total` now leaves out rows with an `org_id`, so org practice never uses up their personal allowance.
- **Why:** The browser chooses but never decides. Stamping once means a member removed mid-interview can finish it, but can't start new org sessions. Keeping `ai_calls` per user keeps abuse protection independent of an org's plan.
- **Considered:** Re-checking membership on every turn (a removed member would lose an interview mid-way); letting the client write `org_id` (forgeable); org limits on `ai_calls` too (marketing sells mocks, not AI calls).
- **Revisit:** If an org plan needs per-member caps, or if marketing wants AI-call pools per org.

## 2026-10-19 · Joining an org: one database function, invites kept across sign-in (M2-Org O.2)
- **Decision:** `join_org()` (security definer, server only) does the whole join with the organisation row locked: invite valid, not expired or used up, email-bound invites match, join codes respect `allowedEmailDomains`, then the seat check (a missing `seats` row means no limit), then the membership, the `org_share` consent and the audit entry. Email invites are single-use 256-bit tokens; join codes are 10 characters (about 50 bits), case- and dash-insensitive. Both are stored only as SHA-256 hashes, and opening or using one is rate-limited to 10 per 10 minutes per user. An invite opened while signed out is kept in localStorage and resumed after sign-in, before onboarding. Org routes use the slug.
- **Why:** Locking the org row is the simplest way to stop two people taking the last seat. Hashes mean a database leak doesn't hand out working invites. The rate limit makes guessing a code impractical. Sign-in has no return URL, and adding one would touch the email-link flow.
- **Considered:** Checking seats in TypeScript (races); a `next=` return parameter through sign-in (more change to a sensitive flow); 6-digit numeric codes (guessable).
- **Revisit:** If sign-in gains a return URL, drop the localStorage step.

## 2026-10-19 · Org tables: RLS stops at membership; admin views go through code (M2.10)
- **Decision:** Add the organisation tables (organizations, memberships, entitlements, cohorts, invites, assignments, audit_logs), with foreign keys from the existing `org_id` columns (set null on org delete) and `assignment_id` on sessions, reports and usage_ledger. RLS lets a user read only the orgs they're active in, their own memberships, and those orgs' cohorts and assignments. Entitlements, invites and audit logs have no user policies, and users can write no org table. An org admin never reads a member's sessions or reports through RLS: M2-Org routes check `can()` / `canViewMember()` in `lib/authz.ts`, read with the secret key and write `audit_logs`. Permissions are a code map (`ROLE_PERMISSIONS`). Share levels are activity < scores < full, default scores, read from the member's latest `org_share` consent. With no secret key, every check denies. See [plans/org-ready-schema.md](plans/org-ready-schema.md).
- **Why:** "The user owns their data" (D11) holds in the database itself. Share-level rules live in one tested function instead of being copied into SQL policies. Custom roles later replace one map.
- **Considered:** RLS policies that let admins read members' reports by share level (share logic duplicated in SQL, and harder to audit); Postgres enums for role and status (every new value would need a migration).
- **Revisit:** If org analytics needs SQL-side aggregation across members (a security-definer view or RPC would then do the share check).

## 2026-10-19 · Honest scores for short interviews
- **Decision:** liveAgent works out coverage (answers of 8+ words against the round's expected questions: `questionCount`, or minutes ÷ 3, at least 3) and tells the scorer. Skills with no evidence come back `assessed: false`. In code, the verdict always follows `overall`, and fewer than 3 answers (or the whole round, if smaller) gives "Too short" with `overall` capped at 40. The app shows "Too short to score" and leaves those reports out of readiness, bests, the progress chart and roadmap digests. Report prompt version is now `2026-10-19.2`. See [plans/honest-scoring.md](plans/honest-scoring.md).
- **Why:** A one-answer test mock scored 62 "Borderline": the scorer filled unseen skills with middling scores, and the app presented that as a full report.
- **Considered:** A second "correction" model. It faces the same missing evidence, and it would double the scoring cost and time. Hiding `overall` entirely (null) would break every chart and type that reads it.
- **Revisit:** Once there's a scored eval set (30–50 transcripts with human scores): measure drift and add calibration only if the numbers show it's needed.

## 2026-10-19 · The server owns the interview context; sessions record versions (M2.3, M2.6)
- **Decision:** Signed in, `/api/interview/turn` and `/report` take only `{ sessionId, answer?, elapsedSec, code }` and load the transcript, config, profile and pack from Supabase. The turn route appends the answer (once per answer id) and the reply, and saves them. The first AI call freezes the pack into `sessions.pack_snapshot`. `prompt_versions` (from liveAgent's `X-Prompt-Version` header), `rubric_version` (a hash of the rubric) and `model_ids` sit next to it as columns that only the server writes. With `AUTH_MODE=off` the browser still sends its context. See [plans/session-versioning-and-trusted-context.md](plans/session-versioning-and-trusted-context.md).
- **Why:** A user could edit the request and get a transcript scored that they never spoke, or swap the rubric. Old reports couldn't be explained after a pack or prompt changed. Using columns keeps the client's `data` upserts from erasing the versions.
- **Considered:** Version fields inside `data` (any client save would overwrite them); a prompt hash computed in Core (Core doesn't see the prompts); having the server write the whole session (would need a different client adapter for one collection).
- **Revisit:** When voice (M3) moves turn-taking into the agent, or when a re-score job needs the versions back in the client.

## 2026-10-19 · History moves to the server (M2.2, M2.4, M2.5)
- **Decision:** Sessions, reports, roadmaps, stories, settings, custom packs, notes, binders and Cortex pages each get a Supabase table of the same shape (`user_id`, `id`, `data` JSONB, timestamps; RLS own rows; `org_id` on sessions and reports). `/api/db/<name>` lists and upserts, `/api/db/<name>/<id>` deletes. `remoteCollection` in `lib/db.ts` caches per page load, updates the screen at once and sends writes through a retry queue saved in localStorage; a newer save of the same item replaces an unsent one. Each signed-in browser uploads its older local data once (only ids the server lacks) and keeps the local copy as a backup.
- **Why:** History has to follow the user across devices, and later work (org views, billing, analytics) needs it on the server. Pages didn't change because they already used the `Collection` interface.
- **Considered:** One generic `user_items` table (fewer tables, but sessions and reports will gain real columns and org policies); saving straight to the server with no queue (a dropped connection mid-interview would lose an answer); IndexedDB offline store (more than the beta needs).
- **Revisit:** M2.3 (versioning columns on sessions), M2.6 (turn route loads the session itself), or if two-device edits start to clash (version numbers per row).

## 2026-10-19 · Package limits live in a packages table
- **Decision:** A `packages` table (`id`, `allowances` JSONB) holds each package's limits, seeded with beta/free/pro. `getPackages()` in `lib/packages-server.ts` reads it with the secret key, caches 60 seconds and falls back to `PACKAGES` in code if the table is empty, invalid or unreachable.
- **Why:** Limits need to change without a deploy (for the beta, and to test a limit live). It's where M6 was going anyway.
- **Considered:** A `PACKAGE_LIMITS` env variable (still needs a redeploy and has no history).
- **Revisit:** M6, when prices and subscriptions join the table.

## 2026-10-19 · Usage allowances by package, recorded in usage_ledger
- **Decision:** Allowances come from the user's package (`lib/packages.ts`; everyone is on `beta`: 5 mocks and 150 AI calls a day, reset at midnight IST). `checkEntitlement(user, meter)` in `lib/policies.ts` sums a new `usage_ledger` table; `authorize()` checks `ai_calls`, the first turn of a mock checks `mocks`, the report records a mock, `callAgent` records each AI call with its request id. See [plans/usage-limits.md](plans/usage-limits.md).
- **Why:** The beta list decides who gets in, not how much they use. Packages and meters keep prices and numbers as config (D15). The ledger was brought forward from M2.2 because Upstash isn't set up on staging, so counts kept in memory would reset on every deploy.
- **Also decided:** a mock under way can always finish (checked at start, counted at report); the ledger failing open is logged, like rate limits; users can read but never write or delete their rows.
- **Considered:** extending the rate limiter with a 24-hour bucket (no packages, resets on deploy without Redis); counters in Redis (another service to run, no history for billing).
- **Revisit:** M6, when subscriptions decide the package; O.5, when org entitlements come first.

## 2026-10-18 · Private beta: invite list
- **Decision:** `BETA_ALLOWED_EMAILS` (comma-separated emails and `@domain` entries) limits who can use staging. Checked at three points: `POST /api/auth/otp` (403 before Supabase sends anything), `/auth/callback` (signs out a Google user who isn't listed), and `authorize()` (403 on every AI route, so removing someone cuts off Gemini immediately). Empty means open. Staging starts with only the owner's address.
- **Why:** The beta runs on the owner's Gemini and Resend budgets; blocking temporary inboxes alone still lets anyone with a Gmail in.
- **Considered:** Turning off sign-ups in Supabase (works, but then every tester's account is made by hand, and it doesn't stop AI use by existing accounts); an invites table in the database (more to build before M2.2).
- **Revisit:** Before the public free tier, when usage limits per plan (M6) replace the list.

## 2026-10-18 · Temporary inboxes can't sign in
- **Decision:** `POST /api/auth/otp` refuses addresses on the `disposable-email-domains-js` list (about 5,000 domains, yopmail and mailinator among them), including their subdomains, with a 400 before Supabase is called. `BLOCKED_EMAIL_DOMAINS` adds domains per deployment without a release. See `lib/emailPolicy.ts`.
- **Why:** Anyone can read those inboxes, so they'd let one person create unlimited free accounts and spend our Gemini and email budget. Refusing before Supabase also saves the email from the 100-a-day Resend quota.
- **Considered:** A hand-kept list (goes stale fast); a paid email-validation API (cost and a network call on every sign-in); checking MX records (slow, and many throwaway services have valid MX).
- **Revisit:** If real users report being blocked, or when phone OTP arrives before the public free tier. Google sign-in isn't checked, since Google accounts aren't throwaway inboxes.

## 2026-10-18 · Staging hosting: both services on Railway
- **Decision:** Core (Next.js) and liveAgent (Python) each run as a service in one Railway project, on the owner's existing Hobby plan. liveAgent has **no public domain**; Core reaches it over Railway's private network. Region: Singapore (Railway has no India region).
- **Why:** The account already exists, so there's one bill and one dashboard. Keeping liveAgent private is safer than exposing it with only a bearer token. liveAgent will become a long-running voice worker (M3), which serverless hosts can't run.
- **Considered:** Vercel for Core with Railway for liveAgent (Vercel's Mumbai region and Next.js tooling, but Vercel Hobby forbids commercial use and liveAgent would need a public URL); Vercel for both (Python only as short functions).
- **Revisit:** Before the beta, if page load from India is slow, or if Railway's Hobby terms don't allow commercial use. Moving Core to Vercel needs no code change.

## 2026-10-18 · liveAgent keeps listening on IPv4 (`0.0.0.0`)
- **Decision:** Leave the Dockerfile's `--host 0.0.0.0` as is.
- **Why:** Considered `--host ::` for Railway's private network, which used to be IPv6-only. But Python's asyncio makes a `::` listener IPv6-only, which could break IPv4 traffic such as health checks, and new Railway environments are expected to reach services over IPv4 privately. It couldn't be tested locally (Docker wasn't running).
- **Revisit:** If Core can't reach `liveagent.railway.internal`, switch to a server that binds both (e.g. two listeners) rather than `::` alone.

## 2026-10-18 · M1.4 usage: liveAgent measures, Core records
- **Decision:** `generate_json` keeps a usage record per Gemini call and liveAgent returns the records in an `X-LLM-Usage` response header. Core's `callAgent` requires the user and logs one `ai.usage` line per call through `recordUsage` (`lib/usage.ts`). See [plans/usage-capture.md](plans/usage-capture.md).
- **Why:** Cost accounting belongs in Core, which knows the user and will own `usage_ledger` ([plans/live-agent-service.md](plans/live-agent-service.md) rule 1). A header keeps the API bodies and generated types unchanged.
- **Also decided:** failed calls are recorded (`ok: false`), because a response that fails validation is still billed; thinking tokens are kept separate (`thoughtTokens`) because they're billed as output; a malformed header is logged and ignored, never failing the user's request; the request id is shared between both services' log lines.
- **Considered:** liveAgent logging only, with Core sending the user id to it (puts cost accounting in the wrong service); usage in every response body (changes every contract).
- **Revisit:** M2.2, when `recordUsage` starts writing `usage_ledger` rows.

## 2026-10-15 · M1.3 truncation limits live in liveAgent
- **Decision:** `LIMITS` in `liveAgent/live_agent/limits.py`, not `lib/limits.ts` as planned. Core's looser request caps stay in `lib/schemas.ts`.
- **Why:** The prompts moved to liveAgent, so the limits that shape them moved too.

## 2026-10-14 · Sign-in (M2.1 first slice), changes from plans/auth.md
- **Decisions:** No Supabase client in the browser; sign-in runs through Core routes, so there are no `NEXT_PUBLIC_*` keys and code sending is rate-limited. `AUTH_MODE=off` in production fails closed with 503 instead of refusing to start. Terms consent is clickwrap. Sign-in and sign-out don't reload the page. The email carries a sign-in link as well as the code; the link works only in the browser that asked for it (PKCE), the code everywhere, including the app.
- **Why:** Fewer keys in the browser and a single place to rate-limit; Next has no clean "refuse to start" hook, and failing closed can be tested.
- **Revisit:** If a native client needs direct Supabase access.

## 2026-10-14 · Sign-in methods (A1–A7, D3)
- **Decision:** Email one-time code everywhere; Google on the web only. Details in [plans/auth.md § Decisions](plans/auth.md#decisions).
- **Why:** The mobile app is a WebView: Google blocks OAuth there and magic links open in the wrong app. A typed code works in both.
- **Revisit:** Native Google sign-in in the app (A2) when app sign-ups justify it; phone OTP before the public free tier.

## 2026-10-14 · M1.6 response shaping moves to liveAgent
- **Decision:** `overall` score clamping and the 3-pack cap run in liveAgent and are tested there; Core's contract tests check what each route sends and how errors pass through.
- **Why:** The shaping belongs with the prompts and schemas that produce the data.

## 2026-10-08 · M1.2 rate limits in route handlers, not proxy
- **Decision:** `enforceRateLimit` at the top of each AI route (now inside `authorize()`); Upstash Redis over REST when configured, in-memory otherwise; fail open if Redis errors.
- **Why:** Next 16's docs advise against shared state in `proxy.ts`; no client library keeps the bundle small; an Upstash outage shouldn't take the app down.
- **Revisit:** If abuse appears during an Upstash outage.

## 2026-10-04 · AI moves to liveAgent, a separate Python service
- **Decision:** All prompts and Gemini calls move from Next.js routes to `liveAgent/` (FastAPI), in this repo, text endpoints first. See [plans/live-agent-service.md](plans/live-agent-service.md).
- **Why:** Web and mobile need one backend, voice (LiveKit Agents) and eval/tuning tooling are Python, and AI calls need their own scaling and cost controls. Same repo, so one change updates both sides of the contract.
- **Changes:** D1 ("keep Next.js route handlers as the API").

## 2026-10-03 · Field profiles and prompt caching
- **Decision:** Field (domain) profiles in Supabase with code defaults; the interviewer system prompt stays identical through a session so Gemini caches it. See [plans/domain-prompts-and-caching.md](plans/domain-prompts-and-caching.md).
- **Why:** A shared, unchanging prefix is what cuts token cost; per-turn data goes at the end.

## 2026-10-03 · Build to expand, decide business questions later (D15)
- **Decision:** Code checks permissions and entitlements, never role or plan names; usage, limits and consents are keyed rows.
- **Why:** Pricing, minors, data residency and screening mode are open; answering them later should be configuration.
