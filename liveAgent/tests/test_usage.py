"""Usage capture (plans/usage-capture.md): a record per Gemini call, returned to Core in X-LLM-Usage."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from live_agent import gemini
from live_agent.main import app
from live_agent.models import HealthOk

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PROFILE = {"id": "p1", "name": "Asha", "targetRole": "Backend Engineer", "targetCompanies": "", "jobDescription": "", "experience": "fresher", "resume": "", "onboarded": True}
DOMAIN = {"id": "general", "interviewerContext": "", "scoringContext": "", "roundHints": "", "roadmapHints": "", "version": 1}
USAGE = SimpleNamespace(prompt_token_count=120, cached_content_token_count=100, candidates_token_count=30, thoughts_token_count=45)


class FakeClient:
    """Stands in for genai.Client at the SDK boundary, so the real generate_json runs."""

    def __init__(self):
        self.text: str | None = '{"ok": true}'
        self.usage: SimpleNamespace | None = USAGE
        self.error: Exception | None = None
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    async def _generate(self, **_):
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text, usage_metadata=self.usage)


@pytest.fixture
def sdk(monkeypatch):
    c = FakeClient()
    monkeypatch.setattr(gemini, "_get_client", lambda: c)
    monkeypatch.setenv("LIVE_AGENT_TOKEN", TOKEN)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    return c


def ping():
    return asyncio.run(gemini.generate_json(task="health", model="m1", system="s", turns=[{"role": "user", "text": "hi"}], schema=HealthOk))


def log_lines(capsys) -> list[dict]:
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if '"llm.usage"' in line]


def test_records_tokens_including_thinking(sdk, capsys):
    with gemini.usage_scope("req-1") as calls:
        assert ping() == HealthOk(ok=True)
    assert calls == [
        {"task": "health", "model": "m1", "ms": calls[0]["ms"], "inputTokens": 120, "cachedTokens": 100, "outputTokens": 30, "thoughtTokens": 45, "ok": True}
    ]
    assert log_lines(capsys) == [{"event": "llm.usage", "requestId": "req-1", **calls[0]}]


def test_schema_mismatch_is_recorded_with_its_tokens(sdk):
    sdk.text = '{"nope": 1}'
    with gemini.usage_scope(None) as calls:
        with pytest.raises(gemini.ApiError) as e:
            ping()
    assert e.value.status == 502
    assert calls[0]["ok"] is False
    assert calls[0]["inputTokens"] == 120


def test_sdk_error_is_recorded_without_tokens(sdk):
    sdk.error = RuntimeError("network down")
    with gemini.usage_scope(None) as calls:
        with pytest.raises(gemini.ApiError):
            ping()
    assert calls[0]["ok"] is False
    assert (calls[0]["inputTokens"], calls[0]["outputTokens"], calls[0]["thoughtTokens"]) == (0, 0, 0)


def test_missing_usage_metadata_counts_as_zero(sdk):
    sdk.usage = None
    with gemini.usage_scope(None) as calls:
        ping()
    assert calls[0]["inputTokens"] == 0 and calls[0]["ok"] is True


def test_works_outside_a_scope(sdk, capsys):
    ping()
    assert log_lines(capsys)[0]["requestId"] is None


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def usage_header(res) -> list[dict]:
    return json.loads(res.headers["x-llm-usage"])


def test_route_returns_usage_header(client, sdk, capsys):
    sdk.text = '{"summary": "s", "items": []}'
    res = client.post("/v1/roadmap", json={"profile": PROFILE, "domain": DOMAIN, "digests": []}, headers={**AUTH, "X-Request-Id": "req-9"})
    assert res.status_code == 200
    [call] = usage_header(res)
    assert call["task"] == "roadmap" and call["thoughtTokens"] == 45 and call["ok"] is True
    assert log_lines(capsys)[0]["requestId"] == "req-9"


def test_usage_header_is_sent_on_errors_too(client, sdk):
    sdk.text = "not json"
    res = client.post("/v1/roadmap", json={"profile": PROFILE, "domain": DOMAIN, "digests": []}, headers=AUTH)
    assert res.status_code == 502
    assert usage_header(res)[0]["ok"] is False


def test_health_reports_both_calls(client, sdk):
    res = client.get("/v1/health/models", headers=AUTH)
    assert res.status_code == 200
    assert [c["task"] for c in usage_header(res)] == ["health", "health"]


def test_no_header_without_a_gemini_call(client, sdk):
    res = client.post("/v1/roadmap", json={}, headers=AUTH)
    assert res.status_code == 400
    assert "x-llm-usage" not in res.headers


def test_long_request_ids_are_cut(client, sdk, capsys):
    sdk.text = '{"summary": "s", "items": []}'
    client.post("/v1/roadmap", json={"profile": PROFILE, "domain": DOMAIN, "digests": []}, headers={**AUTH, "X-Request-Id": "x" * 500})
    assert log_lines(capsys)[0]["requestId"] == "x" * 64
