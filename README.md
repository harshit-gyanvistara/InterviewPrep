# Offerly — interview prep platform (MVP)

Next.js (App Router) + Tailwind. AI via the Gemini API (server routes only). Data in browser `localStorage` behind `lib/db.ts`.

## Run
```bash
cd web
# put your key in .env.local  (GEMINI_API_KEY=...)
npm install
npm run dev        # http://localhost:3000
```
Optional model overrides in `.env.local`: `GEMINI_CHAT_MODEL`, `GEMINI_SCORING_MODEL` (verify IDs in Google AI Studio).

## Structure
- `app/api/interview/turn` — one interviewer turn (JSON `{reply, endInterview}`)
- `app/api/interview/report` — rubric scoring, incl. `expectedAnswer` (the model answer) per question
- `app/api/pack/generate` — builds interview rounds from a pasted job description
- `app/api/roadmap` — weekly prep plan
- `lib/packs.ts` — interview packs + personas (config, not prompts)
- `lib/prompts.ts` — interviewer / scorer prompts
- `lib/db.ts` — storage adapter; replace `localCollection` with a real DB later
- `lib/useSpeech.ts` — browser speech-to-text and text-to-speech (Chrome/Edge/Safari)
- `lib/notesContext.tsx` + `components/NotesPanel.tsx` — the global quick-notes drawer (press "n" or the floating button anywhere), with `NoteChip` for attaching notes to any entity
- `lib/dialogContext.tsx` + `components/ConfirmDialog.tsx` — the app's only confirm/prompt dialogs; never use `window.confirm/alert/prompt`, use `useConfirm()`/`usePrompt()` instead
- `app/cortex/` + `lib/cortex.ts` — **Cortex**, the full rich-text notebook (binders → pages, Tiptap editor with headings/lists/checklists/code/links)

## Moving to a real DB later
`db.*` is already async and collection-based. Re-implement `localCollection` to call API routes (Postgres/Prisma) and add auth; no page code changes needed.
