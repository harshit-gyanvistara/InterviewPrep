# Offerly — interview prep platform (MVP)

Two services:
- **Core**: Next.js (App Router) + Tailwind at the repo root. Accounts (email code, Google on the web) and the user's profile in Supabase; the rest of the user's data in browser `localStorage` behind `lib/db.ts`; the field and pack catalog in Supabase too. Without Supabase it runs with no accounts (`AUTH_MODE=off`) on the code defaults.
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

Other scripts: `npm test` (Vitest unit tests; `npm run test:watch`, `npm run coverage`), `npm run lint`, `npm run typecheck`, `npm run agent:test` (liveAgent's pytest suite), `npm run agent:types` (after changing liveAgent's models or routes: rewrites `liveAgent/openapi.json` and `lib/liveAgent.types.ts`).

### Supabase (optional locally, required in production)
Without it, `npm run dev` runs with no sign-in (`AUTH_MODE=off`, one local user) and the code's catalog. A production server (`next start`) without it refuses every request that needs a user (503).

1. Create a project at supabase.com. Put its URL, **publishable** key and **secret** key in `.env.local` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`). Accounts turn on as soon as the first two are set.
2. Apply `supabase/migrations/*.sql`: paste into the dashboard's SQL Editor, or run `npx supabase db push --db-url "<connection string>"`.
3. `npm run db:seed` copies the fields and packs from `lib/domains` and `lib/packs` into the tables. After that, edit them in Supabase.
4. Sign-in by email code: in Authentication → Emails, make the "Magic link" and "Confirm signup" templates show `{{ .Token }}` (copy `supabase/templates/otp.html`). Set up custom SMTP before real users: the built-in mailer sends only a few emails per hour.
5. Authentication → URL Configuration: set the Site URL to the app's URL and add `<app URL>/auth/callback` to the redirect URLs.
6. Google (optional, web only): enable the Google provider in Supabase, then set `AUTH_GOOGLE=on`.

Local Supabase instead: `npx supabase start` (needs Docker) applies the migrations and uses `supabase/config.toml`; `npx supabase status` prints the URL and keys. `npx vitest run supabase/tests` runs the row-level security tests against it (see the file for the env vars).

## Structure
- `app/api/interview/turn` — one interviewer turn (JSON `{reply, endInterview}`)
- `app/api/interview/report` — rubric scoring, incl. `expectedAnswer` (the model answer) per question
- `app/api/pack/generate` — builds interview rounds from a pasted job description
- `app/api/roadmap` — weekly prep plan
- `app/api/**` AI routes are thin proxies to liveAgent via `lib/liveAgent.ts`; types in `lib/liveAgent.types.ts` are generated
- `liveAgent/live_agent/` — prompts (`prompts.py`), request/response models (`models.py`), Gemini client (`gemini.py`), routes
- `lib/packs.ts` — interview packs + personas (config, not prompts)
- `lib/db.ts` — storage adapter: profile on the server when signed in, the rest in `localStorage` per user
- `lib/auth.ts`, `proxy.ts`, `app/sign-in/`, `app/api/auth/` — accounts (Supabase Auth; see [plans/auth.md](plans/auth.md))
- `lib/useSpeech.ts` — browser speech-to-text and text-to-speech (Chrome/Edge/Safari)
- `lib/notesContext.tsx` + `components/NotesPanel.tsx` — the global quick-notes drawer (press "n" or the floating button anywhere), with `NoteChip` for attaching notes to any entity
- `lib/dialogContext.tsx` + `components/ConfirmDialog.tsx` — the app's only confirm/prompt dialogs; never use `window.confirm/alert/prompt`, use `useConfirm()`/`usePrompt()` instead
- `app/cortex/` + `lib/cortex.ts` — **Cortex**, the full rich-text notebook (binders → pages, Tiptap editor with headings/lists/checklists/code/links)

## Moving the rest to the server
`db.*` is async and collection-based. The profile already goes through `/api/db/profile`; each remaining collection moves by adding its table and schema to `USER_COLLECTIONS` (`lib/userData.ts`) and switching it to a remote adapter in `lib/db.ts` (implementationPlan M2.2–M2.5). No page code changes needed.
