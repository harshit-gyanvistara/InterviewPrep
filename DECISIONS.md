# Decisions log

Every decision made while building Offerly, newest first: what was decided, why, what else was considered, and when to look at it again. The architecture decisions D1–D15 are in [implementationPlan.md Part 3](implementationPlan.md#part-3--key-technical-decisions); entries here refer to them by id. How the plan changed over time is in [FLOWS.md § Initial plan and deviations](FLOWS.md#initial-plan-and-deviations).

Add an entry in the same commit as the change it describes.

---

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
