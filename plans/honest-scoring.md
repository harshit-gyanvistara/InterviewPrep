# Plan: Honest scores for short interviews

**Status: built (2026-10-19).** Follows [session versioning](session-versioning-and-trusted-context.md); the report prompt version is bumped so old and new reports can be told apart.

## Context
A test mock with one answered question scored 62/100 "Borderline". The scorer didn't know how much of the interview happened. It gave middling scores to skills it never saw, and the app showed the result as a full report. A second "correction" model would face the same thin transcript, so it would only add cost and time. The fix is to give the scorer the facts, plus rules in code that the model can't override.

## Design
**Coverage, computed in liveAgent** (`live_agent/scoring.py`):
- `answered`: candidate turns with at least 8 words. Fragments like "yes" or mic noise don't count.
- `expected`: the round's `questionCount` when set (Quick Mock), else `durationMin / 3`, at least 3.
- `sufficient`: `answered >= min(3, expected)`.

**Prompt** (report version `2026-10-19.2`): a COVERAGE line (answers given against expected), and new rules. Score a dimension only with evidence; otherwise set `assessed: false`, score 0, and explain in `feedback`. `overall` comes from assessed dimensions only. Don't write reviews for questions that weren't asked.

**Rules in code** (after the model answers):
- The verdict always follows `overall` (Strong Hire ≥ 85, Hire 70–84, Borderline 50–69, Not Yet < 50), even if the model chose another.
- Not `sufficient` → verdict `"Too short"`, and `overall` is capped at 40, so it never inflates averages.
- The response carries `coverage: { answered, expected, sufficient }`.

**App:**
- On the report page, "Too short" shows "Too short to score" with how many answers counted, instead of the score ring. Unassessed dimensions show "Not enough evidence".
- Dashboard readiness, best score per round, progress chart and roadmap digests skip "Too short" reports (`isScored` in `lib/analysis.ts`).
- Old reports have no `coverage` and keep working.

## Decided later → what we build now → how it expands
| Decision later | Now | Expands to |
|---|---|---|
| Score calibration | Rules + prompt | A scored eval set (30–50 transcripts with human scores); a calibration step if measured drift remains |
| Exact thresholds | Constants in `scoring.py` | Per-round or per-package settings |
| Per-question reference answers | `expectedAnswer` in reviews | Pack-level reference answers the scorer compares against |
