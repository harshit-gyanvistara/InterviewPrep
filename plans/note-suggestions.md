# Plan: Note suggestions from an interview

**Status: built (2026-10-26).**

## Context
After an interview, the report holds what the person should remember (top fixes, weak answers with a stronger version, the weakest skill, filler words, a strong answer worth reusing), but turning that into notes was manual. The user asked for notes suggested from the recent interview that the person can accept or discard.

## Design
**Rules, no AI call** ([lib/noteSuggestions.ts](../lib/noteSuggestions.ts)). `suggestNotes(report)` reads what the report already has, so it is free, instant and works with `AUTH_MODE=off`. Most useful first:

| Kind | From | Limit | Note |
|---|---|---|---|
| `fix` | `topFixes` | 2 | "Fix: …"; body only when the title had to cut the fix short |
| `rehearse` | answers scoring ≤ 5 with a stronger version, lowest first | 2 | "Rehearse: <question>", body = stronger version + what the interviewer expected |
| `skill` | the weakest assessed skill, if below 6 | 1 | "Skill: <name> (score/10)", body = feedback + the quote |
| `delivery` | ≥ 5 fillers per 100 words and ≥ 5 fillers | 1 | "Delivery: cut filler words", with the most used ones |
| `story` | the best answer scoring ≥ 8 | 1 | "Reuse: <question>", body = what they said |

Thresholds live in `SUGGESTION_RULES`. Each suggestion has a key that stays the same for the report (`fix:0`, `rehearse:3`, `skill:Structure`, `fillers`, `story:2`).

**Accept / Discard** ([components/notes/NoteSuggestions.tsx](../components/notes/NoteSuggestions.tsx)):
- Accept saves a normal note, tagged by kind, linked to the interview (`session`) and its round (`pack`), so it also shows on that round's note chip on /practice and in Notes.
- Discard hides the suggestion.
- Both are recorded on the report as `noteSuggestions: { [key]: "accepted" | "discarded" }`, so a suggestion doesn't come back on reload, on another device (signed in), or if the saved note is later deleted. The report is re-read before the write so quick clicks don't overwrite each other.

**Where it shows:**
- The report page, at the top of "Notes on this interview".
- The Notes page, for the most recent interview only, with a link to its report. Older interviews keep their suggestions on their own report pages.

## Decided later → what we build now → how it expands
| Decided later | Built now | How it expands |
|---|---|---|
| Whether AI-written notes are worth a call per report | Rules over the report | Another source returns more `NoteSuggestion`s under its own key prefix; the cards and the record don't change |
| Patterns across interviews ("pacing weak in your last 3") | One report at a time | A function over several reports, shown on the dashboard or Notes with the same cards |
| Edit before saving, "Accept all" | Accept saves as is; the note is editable in Notes | Open `NoteEditor` prefilled from the suggestion |
| Thresholds | `SUGGESTION_RULES` | Tune in one place; per-field values could come from `lib/domains` |

## Follow-ups
- "Reuse" could save straight to the Story bank instead of Notes.
- Watch which kinds get discarded most and tune or drop them.
