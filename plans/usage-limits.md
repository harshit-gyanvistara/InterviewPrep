# Plan: Usage limits by package

**Status: proposed (2026-10-19).** Brings forward part of [implementationPlan.md](../implementationPlan.md) G1 (per-user quotas), M6 (Free/Pro tiers enforced from `usage_ledger`) and O.5 (org quotas), following D15 ([plans/organisations.md § Designed to expand](organisations.md#designed-to-expand)).

## Context
The beta is invite-only (`BETA_ALLOWED_EMAILS`) and Gemini has a spending cap, but nothing limits how much one user uses. The rate limiter in [lib/rateLimit.ts](../lib/rateLimit.ts) stops bursts (per minute / 10 minutes); it isn't an allowance. Every Gemini call is already measured per user ([plans/usage-capture.md](usage-capture.md)): `recordUsage` in [lib/usage.ts](../lib/usage.ts) logs `ai.usage` with `userId`, but nothing is stored or checked.

Allowances belong to **packages** (beta, free, pro, an org's plan), not to code. Prices, package names and the numbers are business decisions made later; this plan builds the mechanism so those decisions are config.

## Design
Two separate mechanisms, kept separate:

| | Rate limits (exists) | Usage limits (this plan) |
|---|---|---|
| Stops | Bursts, scripts, abuse | Using more than the package allows |
| Window | Seconds to minutes | Day, month, or none |
| Keyed by | Route bucket | **Meter** (`mocks`, `ai_calls`, later `voice_minutes`, `tokens`) |
| Number comes from | Code (`RATE_LIMITS`) | The user's **package** |

```
authorize(req, bucket, { meter })              lib/route.ts — unchanged callers except the meter
  ├─ requireUser, beta list, rate limit        (as today)
  └─ checkEntitlement(user, meter)             lib/policies.ts — the one policy function
        ├─ packageFor(user)  → "beta"          today: everyone; M6: subscription row; O.5: org first
        ├─ limitFor(pkg, meter) → { limit, period }   lib/packages.ts (config today, table later)
        └─ usage.count(user, meter, period)    today: limiter store; M2.2: usage_ledger
recordUsage(...)                                adds one count per meter after a successful call
```

**Meters** are validated strings, not enums:
- `ai_calls`: every Gemini-backed request (turns, assist, roadmap, pack generation, report). Protects tokens.
- `mocks`: a finished mock, counted when the report is generated. What users understand and what a package advertises ("5 mocks a day").
- Later: `voice_minutes` (M3), `tokens` (exact cost, from `ai.usage`).

**Packages** live in one place, `lib/packages.ts`:

```ts
// Numbers are placeholders until the business decides them.
export const PACKAGES = {
  beta: { mocks: { limit: 5, period: "day" }, ai_calls: { limit: 150, period: "day" } },
  free: { mocks: { limit: 3, period: "month" }, ai_calls: { limit: 100, period: "month" } },
  pro:  { mocks: { limit: null, period: "none" }, ai_calls: { limit: 2000, period: "month" } },
} satisfies Record<string, Partial<Record<Meter, Allowance>>>;
```

A missing meter means unlimited; `limit: null` means unlimited. Code never checks a package name: it asks `checkEntitlement(user, "mocks")`.

**When over the limit:** `authorize` throws `ApiError(429)` with a message from the package ("You've used today's 5 mocks. They reset at midnight IST.") and `retryAfterSec`. The interview page shows it in place of the next turn. A mock already in progress can always finish: `mocks` is checked when a mock *starts* (first turn) and counted when it's *reported*, so nobody is cut off mid-interview.

**Periods** reset on calendar boundaries in IST (`day` at 00:00, `month` on the 1st), so "resets at midnight" is true and easy to explain. One helper, `periodKey(period, now)`, so a later per-user time zone is a one-line change.

## Decided later → what we build now → how it expands

| Decision later | What we build now | How it expands |
|---|---|---|
| Package names, prices, numbers | `PACKAGES` config with placeholder numbers; beta is the only one in use | Edit numbers, add packages; M6 moves them to a `packages` table |
| Who is on which package | `packageFor(user)` returns `"beta"` | Reads `subscriptions` (M6), then the user's org entitlements (O.5) |
| What to meter | `mocks` and `ai_calls` | Add `voice_minutes`, `tokens` as new strings |
| Where usage is stored | Counts in the limiter store (Upstash, memory locally) | `usage_ledger` rows from `recordUsage` (M2.2); `usage.count` reads the ledger |
| Time zone for resets | IST for everyone | Per-user time zone from the profile |
| Top-ups, rollovers, trials | Nothing | Extra `entitlements` rows with `source` and expiry |

## Action items

### Phase 1: beta allowance (now, no database)
1. `lib/packages.ts`: `Meter`, `Allowance`, `PACKAGES` (beta numbers to confirm), `periodKey()`.
2. `lib/policies.ts`: `packageFor(user)` (returns `"beta"`) and `checkEntitlement(user, meter)` → `{ allowed, used, limit, resetsAt }`. Optional override per deployment: `PACKAGE_DEFAULT` env.
3. `lib/usage.ts`: `countUsage(user, meter, period)` and `addUsage(user, meter)` on the limiter store, keyed `usage:{meter}:{userId}:{periodKey}`.
4. `lib/route.ts`: `authorize(req, bucket, { meter })`; routes pass their meter (`interview/turn` checks `mocks` on the first turn and `ai_calls` always; `interview/report` adds to `mocks`). `LOCAL_USER` (AUTH_MODE=off) is never limited.
5. `GET /api/usage`: the signed-in user's meters (used, limit, resets at) for the UI.
6. UI: remaining mocks on the dashboard and in the interview lobby; the 429 message on the interview page.
7. Tests: per-meter limits, period rollover, mid-interview safety, unlimited meters, `LOCAL_USER`, store outage (fail open, logged, like rate limits).
8. Docs: DECISIONS entry, FLOWS request path, `.env.example`.

### Phase 2: ledger (with M2.2)
9. `usage_ledger` table (`user_id`, `org_id?`, `meter`, `amount`, `request_id`, `created_at`); `recordUsage` inserts rows.
10. `countUsage` reads the ledger; the limiter store goes back to rate limits only.

### Phase 3: packages from billing (M6)
11. `packages` and `subscriptions` tables; `packageFor` reads the active subscription; Razorpay/Stripe webhooks write it.
12. Upgrade prompt on the 429 message and in Settings.

### Phase 4: organisations (O.5)
13. `packageFor` checks the user's org entitlements first (seats, mocks per month), per [plans/organisations.md](organisations.md).

## Open questions (don't block Phase 1)
- Beta numbers: 5 mocks and 150 AI calls a day?
- Does the free tier allow a mock per month or per week?
- Should the roadmap and pack generation have their own meters?

## Verification
- `npm test` covers the cases in item 7.
- On staging with a test limit of 1 mock: a second mock is refused with the reset time; a mock in progress still finishes; `/api/usage` shows the counts; the counts reset after the period.
