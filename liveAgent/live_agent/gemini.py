"""The only module that talks to the Gemini SDK. The API key never leaves this service."""

import json
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal, TypedDict, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class Models:
    @property
    def chat(self) -> str:
        return os.environ.get("GEMINI_CHAT_MODEL") or "gemini-3.8-flash"

    @property
    def scoring(self) -> str:
        return os.environ.get("GEMINI_SCORING_MODEL") or "gemini-pro-latest"


MODELS = Models()


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class ChatTurn(TypedDict):
    role: Literal["user", "model"]
    text: str


_client: genai.Client | None = None


def has_key() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def _get_client() -> genai.Client:
    global _client
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ApiError(503, "GEMINI_API_KEY is not set. Add it to liveAgent/.env and restart the AI service.")
    if _client is None:
        _client = genai.Client(api_key=api_key)
    return _client


class Usage(TypedDict):
    """One Gemini call. Core turns these into usage records (lib/usage.ts); see plans/usage-capture.md."""

    task: str
    model: str
    ms: int
    inputTokens: int
    cachedTokens: int
    outputTokens: int
    thoughtTokens: int
    ok: bool


# The calls made while serving the current request, and Core's id for it. Set by usage_scope().
_calls: ContextVar[list[Usage] | None] = ContextVar("llm_calls", default=None)
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


@contextmanager
def usage_scope(request_id: str | None) -> Iterator[list[Usage]]:
    """Collect a Usage for every generate_json call made inside this block."""
    calls: list[Usage] = []
    tokens = (_calls.set(calls), _request_id.set(request_id))
    try:
        yield calls
    finally:
        _calls.reset(tokens[0])
        _request_id.reset(tokens[1])


async def generate_json(
    *,
    task: str,
    model: str,
    system: str,
    turns: list[ChatTurn],
    schema: type[T],
    temperature: float = 0.7,
) -> T:
    """Generate a JSON object that conforms to `schema`. `task` names the caller for usage records."""
    client = _get_client()
    started = time.monotonic()
    usage = None
    ok = False
    try:
        try:
            res = await client.aio.models.generate_content(
                model=model,
                contents=[types.Content(role=t["role"], parts=[types.Part(text=t["text"])]) for t in turns],
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=temperature,
                ),
            )
        except Exception as e:  # SDK and network errors
            raise ApiError(502, f"Gemini request failed ({model}): {e}") from e

        usage = res.usage_metadata
        text = res.text
        if not text:
            raise ApiError(502, "Gemini returned an empty response.")
        try:
            out = schema.model_validate_json(text)
        except ValidationError as e:
            raise ApiError(502, f"Gemini returned JSON that does not match the schema ({model}): {e}") from e
        ok = True
        return out
    finally:
        # Failed calls are recorded too: a response that fails validation was still billed.
        _record(
            Usage(
                task=task,
                model=model,
                ms=round((time.monotonic() - started) * 1000),
                inputTokens=(usage and usage.prompt_token_count) or 0,
                # The part of the input Gemini served from its prompt cache at a discount.
                cachedTokens=(usage and usage.cached_content_token_count) or 0,
                outputTokens=(usage and usage.candidates_token_count) or 0,
                # Thinking tokens, billed as output.
                thoughtTokens=(usage and usage.thoughts_token_count) or 0,
                ok=ok,
            )
        )


def _record(u: Usage) -> None:
    calls = _calls.get()
    if calls is not None:
        calls.append(u)
    # One structured line per call; Core's ai.usage line (same requestId) adds the user.
    print(json.dumps({"event": "llm.usage", "requestId": _request_id.get(), **u}), flush=True)
