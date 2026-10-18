# Plan: History on the server (M2.2, M2.4, M2.5)

**Status: proposed (2026-10-19).** Implements [implementationPlan.md](../implementationPlan.md) M2.2 (schema), M2.4 (CRUD routes) and M2.5 (swap the adapter) for every collection except the profile, which is already on the server ([plans/auth.md](auth.md)). M2.3 (versioning fields) and M2.6 (server-trusted interview context) stay separate.

## Context
Signed-in users keep their profile on the server, but everything else (interviews, reports, roadmap, stories, notes, Cortex, settings, custom rounds) lives in `localStorage` under a per-user prefix ([lib/db.ts](../lib/db.ts)). So:
- Sign in on a phone and the dashboard is empty; history doesn't follow the user.
- Clearing browser data, or a different browser, loses everything.
- The server can't see reports, so later work (usage by org, progress for coaches, billing) has nothing to read.

What makes this tractable: every page already goes through `db.<collection>` with the same async `Collection<T>` interface (`list/get/put/remove`) and a change event, and the profile already shows the server pattern end to end (`remoteSingleton`, `/api/db/[collection]`, RLS, `lib/userData.ts`). Swapping adapters should not change pages.

## Design

**Tables (one migration).** One table per collection, all the same shape, matching D2 (JSON columns keep the migration small):

```sql
create table public.<name> (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,           -- the client's id (uid()), unchanged
  data       jsonb not null,          -- the item as the app stores it today
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
```
Tables: `sessions`, `reports`, `roadmaps`, `stories`, `settings`, `custom_packs`, `notes`, `binders`, `cortex_pages`. `sessions` and `reports` also get a nullable `org_id` now (M2.10 adds the foreign key), so orgs need no retrofit. RLS: each user reads and writes only their own rows (same policies as `profiles`); anon gets nothing; deleting the account cascades.

Why separate tables, not one generic `user_items` table: sessions and reports will grow real columns and indexes (versioning in M2.3, `org_id`, report scores for analytics), and per-table RLS and grants stay obvious. The shape is identical, so the code is one generic path.

**Routes (M2.4).** Extend `/api/db/[collection]`:
- `GET /api/db/<name>`: the user's items (`data` only), newest first.
- `PUT /api/db/<name>`: upsert one item by `id` (validated: object with string `id`, body ≤ 1 MB as today).
- `DELETE /api/db/<name>/<id>`: remove one item.
The profile keeps its single-item behaviour. All on the user's own session client, so RLS is the guard and the `user_id` filter is a second check.

**Validation.** `USER_COLLECTIONS` in [lib/userData.ts](../lib/userData.ts) gains each collection with a loose Zod schema (must be an object with a string `id`; known fields checked where cheap, unknown fields kept), so older clients and new fields don't break each other.

**Client adapter (M2.5).** A `remoteCollection<T>(name)` next to `remoteSingleton` in `lib/db.ts`:
- Reads the list once per page load and keeps it in memory; `get` reads from that cache.
- `put` / `remove` update the cache and fire the change event immediately (pages feel instant), then send the request.
- If a write fails it is kept in a small retry queue and retried on the next write or page load; the user sees a quiet "Couldn't save, retrying" note instead of losing an answer mid-interview. The last write wins (one user rarely edits on two devices at once).
- `db.sessions`, `db.reports`, … become `byAuth(remoteCollection(...), localCollection(...))`, exactly like the profile, so `AUTH_MODE=off` keeps working from `localStorage`.

**Moving existing data.** On the first page load after this ships, a signed-in user's `localStorage` collections are uploaded once (only items the server doesn't have, matched by `id`), then marked as moved. The local copy is kept untouched as a backup for one release, then cleaned up. Same idea as the earlier `adoptLocalData`.

**Interview turns.** Each turn already saves the whole session; that becomes one `PUT` per turn (a few KB). Fine at this scale. M2.6 later moves the session into the turn route itself.

## Decided later → what we build now → how it expands

| Decision later | What we build now | How it expands |
|---|---|---|
| Which fields become real columns | `data jsonb` plus `created_at`/`updated_at` | Add columns (e.g. `reports.overall`) with a backfill from `data`; the API shape doesn't change |
| Org visibility (coaches see members' reports) | `org_id` on sessions and reports, empty | M2-Org adds share-level policies on top of RLS |
| Offline use | Memory cache + retry queue | A real offline store (IndexedDB) behind the same adapter |
| Conflict handling across devices | Last write wins | Version numbers per row if it becomes a real problem |
| Data retention / export | Rows deleted with the account | Export and retention jobs read the same tables |

## Action items
1. Migration `supabase/migrations/<date>_user_collections.sql`: the nine tables, RLS policies, grants, `updated_at` triggers.
2. `lib/userData.ts`: register the collections with schemas; `listItems` / `putItem` / `removeItem` for multi-item collections (profile unchanged).
3. `/api/db/[collection]` GET/PUT for lists; new `/api/db/[collection]/[id]` DELETE.
4. `lib/db.ts`: `remoteCollection` with cache, change events and retry queue; switch every collection to `byAuth`; `resetSession` clears all caches.
5. One-time upload of existing local data for signed-in users.
6. Tests: routes (ownership, validation, unknown collection, signed out), adapter (cache, events, retry, AUTH_MODE=off), RLS tests for the new tables (cross-user read/write/delete blocked, anon nothing).
7. Docs: DECISIONS, FLOWS § Where data lives, `implementationPlan` M2.2/M2.4/M2.5 status.
8. Apply the migration on Supabase, deploy, verify on two browsers.

## Verification
- `npm test`, typecheck, lint, build; RLS tests against a local Supabase if available.
- On build-score.com: do a mock in Chrome, sign in on a phone (or a private window), see the same report, progress and notes. Delete a note on one, it's gone on the other after reload.
- Existing data: a browser with local history signs in and finds its history on the server afterwards.

## Risks
- **A failed save mid-interview.** Mitigated by the cache + retry queue; worst case the latest answer is retried on the next turn.
- **Large Cortex pages or long transcripts.** Body cap stays 1 MB per item; real transcripts are far smaller.
- **The one-time upload running twice.** Upserts by `(user_id, id)` make it safe to repeat.
