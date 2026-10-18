"""Rules applied to every scored report, after the model answers (plans/honest-scoring.md).

The model is told how much of the interview happened, but these rules hold whatever it returns:
the verdict always follows the overall score, and an interview too short to judge is flagged and
capped so it can't inflate a candidate's averages.
"""

import math

from .models import Coverage, Message, ReportResult, ScoredReport, SessionConfig

# A candidate turn shorter than this is a fragment ("yes", mic noise), not an answer.
MIN_ANSWER_WORDS = 8
# Main questions a round of this length usually covers, when the pack sets no question count.
MINUTES_PER_QUESTION = 3
# Fewer answers than this (or than the round expects, if smaller) can't be scored fairly.
MIN_SCORED_ANSWERS = 3
# The highest overall a too-short interview can show.
TOO_SHORT_CAP = 40


def coverage(config: SessionConfig, messages: list[Message]) -> Coverage:
    answered = sum(1 for m in messages if m.role == "candidate" and len(m.text.split()) >= MIN_ANSWER_WORDS)
    expected = int(config.question_count) if config.question_count else max(MIN_SCORED_ANSWERS, round(config.duration_min / MINUTES_PER_QUESTION))
    return Coverage(answered=answered, expected=expected, sufficient=answered >= min(MIN_SCORED_ANSWERS, expected))


def verdict_for(overall: int) -> str:
    return "Strong Hire" if overall >= 85 else "Hire" if overall >= 70 else "Borderline" if overall >= 50 else "Not Yet"


def apply_rules(scored: ScoredReport, cov: Coverage) -> ReportResult:
    overall = max(0, min(100, math.floor(scored.overall + 0.5)))
    if not cov.sufficient:
        overall = min(overall, TOO_SHORT_CAP)
    verdict = verdict_for(overall) if cov.sufficient else "Too short"
    return ReportResult(**{**scored.model_dump(), "overall": overall, "verdict": verdict, "coverage": cov})
