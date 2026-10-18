"""The rules every scored report goes through (plans/honest-scoring.md)."""

import pytest

from live_agent.models import Message, ScoredReport, SessionConfig
from live_agent.scoring import TOO_SHORT_CAP, apply_rules, coverage

LONG = "I led the migration and measured a forty percent drop in failures."


def answers(n: int, text: str = LONG) -> list[Message]:
    return [Message(role="candidate", text=text) for _ in range(n)]


@pytest.mark.parametrize(
    ("minutes", "question_count", "expected"),
    [(15, None, 5), (30, None, 10), (5, None, 3), (20, 4, 4), (10, 2, 2)],
)
def test_expected_questions(minutes, question_count, expected):
    assert coverage(SessionConfig(persona="neutral", duration_min=minutes, question_count=question_count), []).expected == expected


def test_fragments_dont_count_as_answers():
    msgs = [*answers(2), Message(role="candidate", text="hello hello"), Message(role="interviewer", text=LONG)]
    assert coverage(SessionConfig(persona="neutral", duration_min=15), msgs).answered == 2


def test_sufficient_needs_three_answers_or_the_whole_short_round():
    cfg = SessionConfig(persona="neutral", duration_min=15)
    assert not coverage(cfg, answers(2)).sufficient
    assert coverage(cfg, answers(3)).sufficient
    assert coverage(SessionConfig(persona="neutral", duration_min=10, question_count=2), answers(2)).sufficient


def _scored(overall: float) -> ScoredReport:
    return ScoredReport(overall=overall, verdict="Hire", summary="s", strengths=[], topFixes=[], dimensions=[], answerReviews=[])


@pytest.mark.parametrize(("raw", "verdict"), [(85, "Strong Hire"), (84.4, "Hire"), (69.6, "Hire"), (50, "Borderline"), (49, "Not Yet")])
def test_verdict_follows_overall(raw, verdict):
    cov = coverage(SessionConfig(persona="neutral", duration_min=15), answers(3))
    assert apply_rules(_scored(raw), cov).verdict == verdict


def test_too_short_is_flagged_and_capped():
    cov = coverage(SessionConfig(persona="neutral", duration_min=15), answers(1))
    out = apply_rules(_scored(90), cov)
    assert (out.verdict, out.overall) == ("Too short", TOO_SHORT_CAP)
    assert apply_rules(_scored(20), cov).overall == 20
