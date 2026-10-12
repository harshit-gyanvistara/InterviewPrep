# Plan: Field (domain) prompts + prompt caching to cut interview token cost

> **Update (2026-10-04):** the prompts and Gemini client referenced below now live in `liveAgent/live_agent/prompts.py` and `gemini.py` ([plan](live-agent-service.md)); the field profiles stay in Core's `lib/domains/` and are sent to liveAgent with each request.

## Status (2026-10-03)
| Step | State |
|---|---|
| 1. Cache-friendly interviewer prompt | **Done.** `interviewerSystem` is static per session; time/questions/code go in `interviewState` on the newest message; history trimmed in steps of 20 (`recentWindow`); usage incl. `cachedTokens` logged per call from `generateJson` |
| 2. Field profiles (medical first) | **Done.** [lib/domains/](../lib/domains/) (general, software, medical), `Profile.domain` + picker in onboarding and Settings, 3 medical packs, field hints in turn/report/pack-generate/roadmap prompts. Deferred: per-field persona overrides |
| Storage | **Done.** Fields and built-in packs live in Supabase (`domains`, `packs` tables), read on the server via `getCatalog()` (5-min cache) and served to pages by `/api/catalog`. The code copies seed the tables and are the fallback. See SPEC.md §8 |
| 3. Org overlay | Not started: lands with M2-Org. `resolveDomain(profile, orgDomainId)` and `visibleBuiltInPacks(profile, orgDomainId)` already take the org's field |
| Later: resume brief | Not started |


## Context
User question: if an org (e.g. a medical college) is logged in and we set "this college is medical" first, can we reduce token use?

**Short answer: yes, but the saving comes from *caching a shared prefix*, not from the context itself.** Gemini is stateless: every call re-sends everything, so adding org context *adds* tokens. It saves money only when:
1. the org/domain block is **identical across calls and placed first**, so Gemini serves it from cache at a discounted rate (implicit caching, automatic) or from one explicit cache per org; and
2. knowing the domain lets us **skip calls entirely**: pre-built medical packs instead of a per-student `/api/pack/generate` Pro call.

### Where the tokens go today (one ~20-turn mock)
| Part of each `/api/interview/turn` call | Size | Shared across students of one college? |
|---|---|---|
| Rules + persona + pack (`interviewerSystem`, [lib/prompts.ts:19](../lib/prompts.ts)) | ~600 tokens | Yes, if the pack is the same |
| Resume (≤6000 chars) + JD (≤4000 chars) | ~1,500–2,500 tokens | No, per student |
| History (last 60 messages) | grows ~80 tokens/turn | No, per session |
| TIME / question budget / code | small, **changes every turn** | No |

Roughly 60k+ input tokens per mock, re-sent turn after turn. The **problem**: the TIME line sits in the middle of the system prompt ([lib/prompts.ts:44](../lib/prompts.ts)), so the system prompt changes on every turn and nothing after that line (rest of the system prompt + the whole history) can be served from cache.

## Approach

### Step 1: Make every session's prompt cache-friendly (no orgs needed, biggest win)
- Split `interviewerSystem` into a **static** system prompt (base rules → domain/org block → pack → persona → candidate) that is byte-identical for the whole session.
- Move dynamic state (elapsed time, time left, question budget, current code) out of the system prompt into a short bracketed note on the **last** user turn in `toTurns` ([lib/prompts.ts:63](../lib/prompts.ts)), e.g. `[STATE: 7 of 15 min, ~3 main questions asked]`.
- Result: from turn 2 onward, system prompt + all earlier history form an identical prefix → Gemini implicit caching applies to most input tokens.
- Measure: return `usageMetadata.cachedContentTokenCount` from `generateJson` ([lib/gemini.ts](../lib/gemini.ts); the SDK exposes it) and log it per route (this is M1.4).
- Verify at build time from Gemini docs: implicit-cache minimum prompt size and discount for the configured `MODELS.chat`.

### Step 2: Domain profiles (medical first)
- New `lib/domains/` with `DomainProfile` data: `id`, `label`, a compact `interviewerContext` block (norms: viva, OSCE/MMI, ethics, patient communication, "never give real medical advice"), domain packs, default rubric, persona overrides, hints for pack-gen / roadmap / scoring (e.g. "penalise unsafe clinical answers", "don't penalise misheard drug names").
- `resolveDomain(org?, profile)`: org's domain → `profile.domain` (new optional field) → inferred from role/JD (generalises `isTechnical` in [lib/packs.ts:146](../lib/packs.ts)) → `"general"`.
- Domain block goes **right after base rules**, before anything per-student, so it is part of the shared prefix.
- Token savings here:
  - Pre-built medical packs replace most `/api/pack/generate` calls (Pro model, up to 8000-char JD + 4000-char resume each).
  - Domain-specific prompts drop irrelevant text (coding block, "any profession" hedging in the pack-gen and roadmap prompts).

### Step 3: Org overlay (when M2-Org lands)
- `organizations.settings.prompt`: structured slots, not free-form full prompts. Slots: `domainId`, `institutionName`, `extraContext` (capped ~1,000 chars), `emphasisTopics`, allowed packs, default persona. Base rules (safety, injection handling, output format) stay platform-owned, so all orgs get prompt upgrades and every prompt stays testable.
- Org packs are generated **once per org** and shared by every member, instead of one generation per student.
- Optional, only if the shared prefix (base + domain + org + pack) passes the explicit-cache minimum: one Gemini explicit cache per org+pack (`config.cachedContent`), recreated when the org's prompt version changes. Storage is billed per hour, so enable it only for orgs with steady traffic.
- Store `promptVersion` (base version + domain version + org settings hash) on each session (G8 / M2.3).

### Later, optional
Compress the resume once into a ~300-token "candidate brief" at onboarding, used in place of the 6000-char resume on every turn. Gate this on interviewer quality (M4.4 evals), because resume details drive realism.

## Critical files
- Modify: [lib/prompts.ts](../lib/prompts.ts) (split static/dynamic, domain block), [lib/gemini.ts](../lib/gemini.ts) (return usage incl. cached tokens), [app/api/interview/turn/route.ts](../app/api/interview/turn/route.ts), [lib/packs.ts](../lib/packs.ts) (`domains` → domain ids, `inferDomain`), [lib/types.ts](../lib/types.ts) (`Profile.domain?`), pack-gen / roadmap / report routes (domain hints), onboarding (domain picker), SPEC.md.
- New: [lib/domains/](../lib/domains/) (`index`, `general`, `software`, `medical`).

## Verification
- Unit tests: for the same session, `interviewerSystem` output is identical across turns with different elapsed times; dynamic state appears only on the last turn; `resolveDomain` precedence.
- Run a 10-turn text-mode mock and check logs: `cachedContentTokenCount` > 0 from turn 2 on, rising with history; compare billed input tokens before/after on the same scripted transcript.
- Medical profile: medical packs show in `/practice`; the interviewer asks viva/MMI-style questions; the report uses the medical rubric.
- `npm run lint && npx tsc --noEmit`; check that interview pacing (wrap-up near time limit, Quick Mock question budget) still works with state moved to the last turn.
