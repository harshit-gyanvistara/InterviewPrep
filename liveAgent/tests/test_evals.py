"""The report eval cases (plans/report-eval-set.md) are valid requests with sane expectations. No Gemini calls."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from eval_report import check, load_cases, signed_error  # noqa: E402

from live_agent.models import ReportRequest  # noqa: E402

VERDICTS = {"Strong Hire", "Hire", "Borderline", "Not Yet", "Too short"}
CASES = load_cases()


def test_there_are_cases():
    assert len(CASES) >= 8


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case_is_a_valid_request_with_sane_ranges(case):
    body = ReportRequest.model_validate(case["body"])
    expect = case["expect"]
    lo, hi = expect["overall"]
    assert 0 <= lo <= hi <= 100
    assert expect["verdicts"] and set(expect["verdicts"]) <= VERDICTS
    for name, (dlo, dhi) in expect.get("dimensions", {}).items():
        assert name in body.pack.rubric and 0 <= dlo <= dhi <= 10


def test_signed_error():
    assert [signed_error(v, 40, 60) for v in (30, 40, 50, 60, 75)] == [-10, 0, 0, 0, 15]


def test_check_reports_each_miss():
    expect = {"overall": [0, 35], "verdicts": ["Not Yet"], "dimensions": {"Ownership": [0, 4]}}
    report = {"overall": 90, "verdict": "Strong Hire", "dimensions": [{"name": "Ownership", "score": 9, "assessed": True}]}
    assert check(expect, report) == ["overall 90 not in 0-35", "verdict Strong Hire not in ['Not Yet']", "Ownership 9 not in 0-4"]
    assert check(expect, {**report, "overall": 20, "verdict": "Not Yet", "dimensions": [{"name": "Ownership", "score": 2}]}) == []
