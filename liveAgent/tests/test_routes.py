"""Route behaviour with Gemini mocked: auth, validation, error shape and post-processing."""

import pytest
from fastapi.testclient import TestClient

from live_agent import gemini
from live_agent.limits import LIMITS
from live_agent.main import app
from live_agent.models import (
    AssistResult,
    GeneratedPack,
    HealthOk,
    PacksResult,
    ScoredReport,
    RoadmapResult,
    TurnResult,
)
from live_agent.prompts import PROMPT_VERSIONS
from live_agent.routes import assist, health, interview, packs, roadmap

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

PROFILE = {"id": "p1", "name": "Asha", "targetRole": "Backend Engineer", "targetCompanies": "", "jobDescription": "", "experience": "fresher", "resume": "", "onboarded": True}
PACK = {"id": "b", "title": "Behavioural", "company": "Any employer", "role": "Graduate", "roundType": "behavioural", "description": "", "durationMin": 20, "topics": ["Intro"], "rubric": ["Clarity"], "style": "Calm", "domains": "all"}
CONFIG = {"packId": "b", "persona": "tough", "durationMin": 20, "pressure": False}
DOMAIN = {"id": "general", "interviewerContext": "", "scoringContext": "", "roundHints": "", "roadmapHints": "", "version": 1}
PERSONA = {"name": "Marcus", "tone": "Skeptical."}
MESSAGES = [
    {"id": "1", "role": "interviewer", "text": "Hi, tell me about yourself.", "at": 0},
    {"id": "2", "role": "candidate", "text": "I build APIs.", "at": 1000},
]


class FakeGemini:
    def __init__(self):
        self.calls: list[dict] = []
        self.result = None
        self.error: gemini.ApiError | None = None

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def fake(monkeypatch):
    f = FakeGemini()
    for module in (interview, packs, roadmap, assist, health):
        monkeypatch.setattr(module, "generate_json", f)
    monkeypatch.setenv("LIVE_AGENT_TOKEN", TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    return f


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_healthz_needs_no_auth(client):
    assert client.get("/healthz").json() == {"ok": True}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}])
def test_v1_rejects_bad_token(client, fake, headers):
    res = client.post("/v1/assist", json={"mode": "generate", "instruction": "x"}, headers=headers)
    assert res.status_code == 401
    assert res.json() == {"error": "Unauthorized."}
    assert fake.calls == []


def test_v1_fails_closed_without_configured_token(client, fake, monkeypatch):
    monkeypatch.delenv("LIVE_AGENT_TOKEN")
    res = client.post("/v1/assist", json={"mode": "generate", "instruction": "x"}, headers=AUTH)
    assert res.status_code == 503


def test_turn(client, fake):
    fake.result = TurnResult(reply="Why APIs?", endInterview=False)
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "persona": PERSONA, "domain": DOMAIN, "messages": MESSAGES, "elapsedSec": 90}
    res = client.post("/v1/interview/turn", json=body, headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"reply": "Why APIs?", "endInterview": False}
    assert res.headers["X-Prompt-Version"] == PROMPT_VERSIONS["interview.turn"]
    call = fake.calls[0]
    assert call["task"] == "interview.turn"
    assert call["temperature"] == 0.8  # tough persona
    assert "YOUR NAME: Marcus" in call["system"]
    assert call["turns"][0]["text"].startswith("[The candidate has joined")
    assert call["turns"][-1]["text"].endswith("[STATE: 2 of 20 min used, about 19 min left.]")


def test_turn_rejects_pack_without_topics(client, fake):
    body = {"config": CONFIG, "profile": PROFILE, "pack": {**PACK, "topics": []}, "persona": PERSONA, "domain": DOMAIN}
    res = client.post("/v1/interview/turn", json=body, headers=AUTH)
    assert res.status_code == 400
    assert res.json()["error"].startswith("Invalid interview configuration.")
    assert fake.calls == []


ANSWER = "I designed the queue, wrote the retry logic and measured the drop in failures."
# Three substantive answers: enough to score (plans/honest-scoring.md).
FULL = [*MESSAGES, *[{"role": r, "text": t} for _ in range(3) for r, t in (("interviewer", "Tell me more."), ("candidate", ANSWER))]]


def _report(overall: float, verdict: str = "Hire") -> ScoredReport:
    return ScoredReport(overall=overall, verdict=verdict, summary="s", strengths=[], topFixes=["a", "b", "c"], dimensions=[], answerReviews=[])


@pytest.mark.parametrize(("raw", "expected"), [(72.5, 73), (140, 100), (-3, 0)])
def test_report_clamps_and_rounds_overall(client, fake, raw, expected):
    fake.result = _report(raw)
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": FULL, "code": "print(1)"}
    res = client.post("/v1/interview/report", json=body, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["overall"] == expected
    assert res.headers["X-Prompt-Version"] == PROMPT_VERSIONS["interview.report"]
    transcript = fake.calls[0]["turns"][0]["text"]
    assert "Marcus: Hi, tell me about yourself.\nAsha: I build APIs." in transcript
    assert transcript.endswith("[FINAL CODE IN EDITOR]\nprint(1)")


def test_report_verdict_follows_overall(client, fake):
    fake.result = _report(88, verdict="Borderline")
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": FULL}
    out = client.post("/v1/interview/report", json=body, headers=AUTH).json()
    assert (out["overall"], out["verdict"]) == (88, "Strong Hire")
    assert out["coverage"] == {"answered": 3, "expected": 7, "sufficient": True}
    assert "COVERAGE: the candidate gave 3 substantive answer(s); a full round has about 7 main questions.\n" in fake.calls[0]["system"]


def test_report_flags_and_caps_a_too_short_interview(client, fake):
    fake.result = _report(62, verdict="Borderline")
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": [*MESSAGES[:1], {"role": "candidate", "text": ANSWER}]}
    out = client.post("/v1/interview/report", json=body, headers=AUTH).json()
    assert (out["overall"], out["verdict"]) == (40, "Too short")
    assert out["coverage"] == {"answered": 1, "expected": 7, "sufficient": False}
    assert "too few to judge the round" in fake.calls[0]["system"]


def test_report_caps_transcript(client, fake):
    fake.result = _report(70)
    messages = [{"role": "candidate", "text": "a" * 5000}] * (LIMITS.transcript_chars // 5000 + 2)
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": messages}
    assert client.post("/v1/interview/report", json=body, headers=AUTH).status_code == 200
    assert len(fake.calls[0]["turns"][0]["text"]) == len("TRANSCRIPT\n") + LIMITS.transcript_chars


def test_report_caps_final_code(client, fake):
    fake.result = _report(70)
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": MESSAGES, "code": "c" * (LIMITS.code_chars + 100)}
    assert client.post("/v1/interview/report", json=body, headers=AUTH).status_code == 200
    assert fake.calls[0]["turns"][0]["text"].endswith("[FINAL CODE IN EDITOR]\n" + "c" * LIMITS.code_chars)


def test_turn_sends_a_bounded_history(client, fake):
    fake.result = TurnResult(reply="ok", endInterview=False)
    roles = ["interviewer", "candidate"]
    messages = [{"role": roles[i % 2], "text": f"m{i}"} for i in range(LIMITS.history_messages * 3)]  # ends on a candidate
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "persona": PERSONA, "domain": DOMAIN, "messages": messages}
    assert client.post("/v1/interview/turn", json=body, headers=AUTH).status_code == 200
    turns = fake.calls[0]["turns"]
    # recent_window keeps <= history_messages; to_turns may add the opening "joined" turn.
    assert len(turns) <= LIMITS.history_messages + 1
    assert turns[-1]["text"].startswith(f"m{len(messages) - 1}\n\n[STATE:")


def test_report_without_candidate_answers_is_422(client, fake):
    body = {"config": CONFIG, "profile": PROFILE, "pack": PACK, "domain": DOMAIN, "interviewerName": "Marcus", "messages": MESSAGES[:1]}
    res = client.post("/v1/interview/report", json=body, headers=AUTH)
    assert res.status_code == 422
    assert res.json() == {"error": "No candidate answers to evaluate."}


def _pack(i: int) -> GeneratedPack:
    return GeneratedPack(title=f"R{i}", company="Any employer", role="Nurse", roundType="hr", description="d", durationMin=15, topics=["t"], rubric=["r"], style="s")


def test_pack_generate_caps_packs(client, fake):
    fake.result = PacksResult(packs=[_pack(i) for i in range(LIMITS.generated_packs + 2)])
    res = client.post("/v1/packs/generate", json={"profile": PROFILE, "domain": DOMAIN}, headers=AUTH)
    assert res.status_code == 200
    assert [p["title"] for p in res.json()["packs"]] == [f"R{i}" for i in range(LIMITS.generated_packs)]


def test_pack_generate_empty_is_502(client, fake):
    fake.result = PacksResult(packs=[])
    res = client.post("/v1/packs/generate", json={"profile": PROFILE, "domain": DOMAIN}, headers=AUTH)
    assert res.status_code == 502


def test_pack_generate_needs_role(client, fake):
    res = client.post("/v1/packs/generate", json={"profile": {**PROFILE, "targetRole": "  "}, "domain": DOMAIN}, headers=AUTH)
    assert res.status_code == 400
    assert res.json() == {"error": "Missing target role."}


@pytest.mark.parametrize(
    ("weeks", "expected"),
    [(None, LIMITS.roadmap_weeks_default), (0, LIMITS.roadmap_weeks_default), (40, LIMITS.roadmap_weeks_max), (2, 2)],
)
def test_roadmap_clamps_weeks_and_sends_digests_as_js_json(client, fake, weeks, expected):
    fake.result = RoadmapResult(summary="s", items=[])
    digests = [{"pack": "Behavioural — “HR”", "overall": 62, "weakDimensions": ["Structure"], "topFixes": []}] * (LIMITS.roadmap_digests + 5)
    res = client.post("/v1/roadmap", json={"profile": PROFILE, "domain": DOMAIN, "weeks": weeks, "digests": digests}, headers=AUTH)
    assert res.status_code == 200
    call = fake.calls[0]
    assert call["system"].startswith(f"You are a career coach building a {expected}-week")
    sent = call["turns"][0]["text"]
    assert sent.startswith('[{"pack":"Behavioural — “HR”","overall":62,"weakDimensions":["Structure"],"topFixes":[]},')
    assert sent.count('"pack"') == LIMITS.roadmap_digests


@pytest.mark.parametrize(
    ("body", "error"),
    [
        ({"mode": "improve", "text": "   "}, "Nothing to improve yet — write something first."),
        ({"mode": "generate", "instruction": " "}, "Say what you'd like written."),
    ],
)
def test_assist_validation(client, fake, body, error):
    res = client.post("/v1/assist", json=body, headers=AUTH)
    assert res.status_code == 400
    assert res.json() == {"error": error}


def test_assist(client, fake):
    fake.result = AssistResult(html="<p>Hi</p>")
    res = client.post("/v1/assist", json={"mode": "improve", "text": "hi"}, headers=AUTH)
    assert res.json() == {"html": "<p>Hi</p>"}
    assert fake.calls[0]["temperature"] == 0.4


def test_gemini_error_passes_through(client, fake):
    fake.error = gemini.ApiError(502, "Gemini request failed (m): boom")
    res = client.post("/v1/assist", json={"mode": "improve", "text": "hi"}, headers=AUTH)
    assert res.status_code == 502
    assert res.json() == {"error": "Gemini request failed (m): boom"}


def test_models_health(client, fake):
    fake.result = HealthOk(ok=True)
    res = client.get("/v1/health/models", headers=AUTH)
    body = res.json()
    assert res.status_code == 200
    assert body["ok"] is True and body["hasKey"] is True
    assert body["chat"]["ok"] and body["scoring"]["ok"]
    assert "error" not in body


def test_models_health_without_key(client, fake, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    res = client.get("/v1/health/models", headers=AUTH)
    assert res.status_code == 503
    assert res.json() == {"ok": False, "hasKey": False, "error": "GEMINI_API_KEY is not set in liveAgent/.env"}
