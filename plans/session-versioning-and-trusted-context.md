# Plan: Session versioning and server-trusted interview context (M2.3, M2.6)

**Status: built (2026-10-19).** Implements [implementationPlan.md](../implementationPlan.md) M2.3 (versioning fields, G8) and M2.6 (server-trusted context).

## Context
Today the browser sends `/api/interview/turn` and `/report` the whole context: config, profile, pack and transcript. So:
- A user can edit the request and score a transcript they never spoke, or swap in a different pack or rubric.
- Packs and prompts change without any record, so an old report can't be explained or reproduced.

After M2.5 the session, profile and custom packs are on the server, so the routes can load them.

## Design

**Server-owned columns on `sessions`** (migration): `pack_snapshot jsonb`, `prompt_versions jsonb` (`{ "turn": "...", "report": "..." }`), `rubric_version text`, `model_ids text[]`. The client's `PUT /api/db/sessions` upserts only `data`, so it can never overwrite them. They're columns rather than fields in `data` for that reason, and so analytics can query them.

**Pack snapshot.** On the first turn (or the report, if there was none), the server resolves the pack (built-in catalog first, then the user's `custom_packs`) and saves it to `pack_snapshot`. Every later call uses the snapshot, so editing a custom round mid-interview, or a catalog change, doesn't change a session that's already running. `rubric_version` is a short hash of the snapshot's rubric list.

**Prompt versions.** liveAgent gets `PROMPT_VERSIONS` (one per prompt) and returns the version used in an `X-Prompt-Version` header, next to `X-LLM-Usage`. Bump the version whenever a prompt's golden output changes (rule in CONTRIBUTING). Model ids come from the usage records Core already parses.

**Turn route, signed in.** Body: `{ sessionId, answer?: { id, text, at }, elapsedSec, code }`. The server loads the session row, the profile and the pack snapshot. It appends `answer` unless that message id is already there (a retry), calls liveAgent, appends the interviewer message, then writes `data.messages`/`data.code` and the version columns. It returns `{ reply, endInterview, message }`, and the client saves that same message, so both copies agree.

**Report route, signed in.** Body: `{ sessionId, code }`. Transcript, config, profile and pack all come from the server.

**`AUTH_MODE=off`** (local dev, CI) has no database. The client also sends `context: { config, profile, pack, messages }`, and the server uses it only when auth is off. When signed in, the server ignores it.

## Decided later → what we build now → how it expands

| Decision later | What we build now | How it expands |
|---|---|---|
| Reproducing / re-scoring old reports | Snapshot + versions stored per session | A re-score job reads the snapshot and the prompt version |
| Prompt A/B tests | Version string per prompt | liveAgent picks a variant, reports it in the same header |
| Org-assigned packs | Snapshot taken at first turn | Assignment pins the pack before the session starts |
| Showing versions in the UI | Columns only, not returned to the client | Add to the GET if a "scored with" footer is wanted |

## Action items
1. Migration: the four columns on `sessions`.
2. liveAgent: `PROMPT_VERSIONS`, `X-Prompt-Version` header, test.
3. `lib/interviewContext.ts`: load the session, profile and pack (snapshot or resolve), and save the turn and versions.
4. Schemas: `TurnBodySchema`/`ReportBodySchema` become `{ sessionId, … , context? }`.
5. Routes use the loader; `callAgent` also returns the prompt version and models.
6. Interview page sends the lean body (plus `context` when signed out) and saves the returned message.
7. Tests (contract tests, loader), docs (FLOWS §4, DECISIONS, implementationPlan, CONTRIBUTING).
8. Apply the migration on Supabase.

## Risks
- **The session row isn't on the server yet** (its first save is still in the retry queue). The route returns 409 "Still saving your interview, try again"; the client retries once after flushing the queue.
- **Write race:** a delayed client PUT carrying only the candidate message lands after the server's write. The next client PUT (which carries the reply) fixes it; the data is never lost, only briefly stale.
