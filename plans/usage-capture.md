# Plan: Usage capture (M1.4)

**Status: built (2026-10-18).** Implements [implementationPlan.md](../implementationPlan.md) M1.4.

## Context
Every Gemini call already goes through one function, `generate_json` in [liveAgent/live_agent/gemini.py](../liveAgent/live_agent/gemini.py), and it already prints one `llm.usage` line per call (`task`, `model`, `ms`, input/cached/output tokens). Four gaps remain:

1. **No user.** liveAgent is stateless and never sees who is calling, so the line can't be tied to a user. Per-user quotas (M2/M6) and the `usage_ledger` table (M2.2) need that.
2. **Under-counted cost.** Gemini bills thinking tokens (`thoughts_token_count`) as output, and the line leaves them out.
3. **Failed calls are invisible.** An SDK or network error raises before the log line. A response that fails schema validation still costs tokens, but nothing marks it as failed.
4. **The record is in the wrong service.** [plans/live-agent-service.md](live-agent-service.md) puts auth, quotas and cost accounting in Core. liveAgent has no database and shouldn't get one for this.

## Design
liveAgent measures and Core records.

```
Core callAgent ──X-Request-Id──► liveAgent ──► generate_json ──► Gemini
     ▲                              │ one record per Gemini call, kept per request
     └──── X-LLM-Usage: [{...}] ────┘
recordUsage({ userId, route, requestId, status }, calls)  →  ai.usage log line (M2: usage_ledger row)
```

**liveAgent**
- `generate_json` builds one record per call: `task`, `model`, `ms`, `inputTokens`, `cachedTokens`, `outputTokens`, `thoughtTokens`, `ok`. It writes the record in a `finally`, so SDK errors (`ok: false`, zero tokens) and schema mismatches (`ok: false`, real tokens) are counted too. The `llm.usage` log line stays, now with `requestId`.
- A small ASGI middleware in `main.py` reads `X-Request-Id`, gives the request a fresh list of records (a `ContextVar`), and adds them to the response as `X-LLM-Usage` (compact JSON array). The header is also sent on errors that go through `ApiError`, so a 502 after a schema mismatch still reports its tokens. `/v1/health/models` makes two calls and reports two records.
- Nothing in the request or response bodies changes, so `openapi.json` and `lib/liveAgent.types.ts` stay the same.

**Core**
- `callAgent(path, body, { user, timeoutMs? })`: `user` is required, so every Gemini call has an owner. It sends `X-Request-Id` (a new UUID) and, whether liveAgent answered OK or with an error, passes the `X-LLM-Usage` records to `recordUsage`.
- `lib/usage.ts`: `parseUsageHeader()` (returns nothing if the header is missing or malformed, so a bad header never fails a user's request) and `recordUsage(ctx, calls)`. For now `recordUsage` logs one `ai.usage` line per call: `userId`, `route` (the liveAgent path), `requestId`, `status`, plus the record. It's the one function M2 changes to insert into `usage_ledger`.
- No email or other personal data in the line; `userId` is the Supabase UUID (`local` with `AUTH_MODE=off`).

## Decisions deferred → what we build now → how it expands
| Decided later | Built now | Expands by |
|---|---|---|
| Quotas and plans (M2/M6) | Every call carries a `userId`, and `recordUsage` is the only place that writes | `recordUsage` inserts into `usage_ledger`; `checkEntitlement()` reads it before `callAgent` |
| Pricing per model | Raw token counts per model, thinking tokens kept separate | A price table keyed by model turns rows into cost, with no logging changes |
| Org billing (M2-Org) | `ctx` is an object | Add `orgId` / `assignmentId` to `ctx` and to the ledger row |
| Log/metrics vendor (M1.5, M1.7) | Structured one-line JSON on stdout from both services, joined by `requestId` | Any log drain (Vercel, Axiom, Datadog) can parse it as is |
| Voice minutes (M3) | Records have a `task` and the ledger plans a `meter` column | The voice agent sends records with `meter: voice_minutes` through the same function |

## Files
| File | Change |
|---|---|
| [liveAgent/live_agent/gemini.py](../liveAgent/live_agent/gemini.py) | Usage record per call incl. `thoughtTokens` and `ok`; `usage_scope()` context manager; `requestId` in the log line |
| [liveAgent/live_agent/main.py](../liveAgent/live_agent/main.py) | `UsageHeaderMiddleware` |
| `liveAgent/tests/test_usage.py` | `generate_json` with a fake Gemini client: success, schema mismatch, SDK error; the header on a real route, including on a 502 |
| `lib/usage.ts`, `lib/usage.test.ts` | `parseUsageHeader`, `recordUsage` |
| [lib/liveAgent.ts](../lib/liveAgent.ts) | `user` option, `X-Request-Id`, record usage |
| `app/api/*/route.ts` (6 routes) | Pass the user from `authorize()` |
| [lib/api.contract.test.ts](../lib/api.contract.test.ts) | Every route sends `X-Request-Id` and records the usage from liveAgent's header, on 200 and on errors |
| [SPEC.md](../SPEC.md) §3 | Document the two headers and the log lines |

## Exit
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run agent:test` pass; `openapi.json` unchanged.
- A real mock run locally prints an `ai.usage` line in the Next.js console for each turn and the report, with `userId` and `thoughtTokens`, and a liveAgent `llm.usage` line with the same `requestId`.

## Not in this slice
- The `usage_ledger` table and quota checks (M2.2, M2/M6).
- Returning the request id to the browser for support tickets (worth adding with M1.5 error tracking).
