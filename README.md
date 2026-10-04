# Offerly — interview prep platform (MVP)

Two services:
- **Core**: Next.js (App Router) + Tailwind at the repo root. User data in browser `localStorage` behind `lib/db.ts`; the field and pack catalog in Supabase (optional, falls back to code defaults).
- **liveAgent**: the Python AI service in [`liveAgent/`](liveAgent/README.md) (FastAPI + Gemini). Every AI feature goes Browser → Core `/api/*` → liveAgent → Gemini. Only liveAgent holds the Gemini key.

## Run
Needs Node and Python 3.12+.
```bash
cp .env.example .env.local                  # set LIVE_AGENT_TOKEN
cp liveAgent/.env.example liveAgent/.env    # set GEMINI_API_KEY and the same LIVE_AGENT_TOKEN
npm install
npm run agent:setup  # once: creates liveAgent/.venv
npm run agent        # terminal 1: liveAgent on http://localhost:8000
npm run dev          # terminal 2: http://localhost:3000
```
Optional model overrides in `liveAgent/.env`: `GEMINI_CHAT_MODEL`, `GEMINI_SCORING_MODEL` (verify IDs in Google AI Studio). Settings → Data & AI → AI connection test checks the whole chain.

Other scripts: `npm run agent:test` (liveAgent's pytest suite), `npm run agent:types` (after changing liveAgent's models or routes: rewrites `liveAgent/openapi.json` and `lib/liveAgent.types.ts`).

### Supabase (optional)
1. Create a project at supabase.com. Put its URL and **secret** key in `.env.local` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
2. Apply `supabase/migrations/*.sql`: paste into the dashboard's SQL Editor, or run `npx supabase db push --db-url "<connection string>"`.
3. `npm run db:seed` copies the fields and packs from `lib/domains` and `lib/packs` into the tables. After that, edit them in Supabase.

## Structure
- `app/api/interview/turn` — one interviewer turn (JSON `{reply, endInterview}`)
- `app/api/interview/report` — rubric scoring, incl. `expectedAnswer` (the model answer) per question
- `app/api/pack/generate` — builds interview rounds from a pasted job description
- `app/api/roadmap` — weekly prep plan
- `app/api/**` AI routes are thin proxies to liveAgent via `lib/liveAgent.ts`; types in `lib/liveAgent.types.ts` are generated
- `liveAgent/live_agent/` — prompts (`prompts.py`), request/response models (`models.py`), Gemini client (`gemini.py`), routes
- `lib/packs.ts` — interview packs + personas (config, not prompts)
- `lib/db.ts` — storage adapter; replace `localCollection` with a real DB later
- `lib/useSpeech.ts` — browser speech-to-text and text-to-speech (Chrome/Edge/Safari)
- `lib/notesContext.tsx` + `components/NotesPanel.tsx` — the global quick-notes drawer (press "n" or the floating button anywhere), with `NoteChip` for attaching notes to any entity
- `lib/dialogContext.tsx` + `components/ConfirmDialog.tsx` — the app's only confirm/prompt dialogs; never use `window.confirm/alert/prompt`, use `useConfirm()`/`usePrompt()` instead
- `app/cortex/` + `lib/cortex.ts` — **Cortex**, the full rich-text notebook (binders → pages, Tiptap editor with headings/lists/checklists/code/links)

## Moving to a real DB later
`db.*` is already async and collection-based. Re-implement `localCollection` to call API routes (Postgres/Prisma) and add auth; no page code changes needed.
