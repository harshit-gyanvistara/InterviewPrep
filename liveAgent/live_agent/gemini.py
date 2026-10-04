"""The only module that talks to the Gemini SDK. The API key never leaves this service."""

import json
import os
import time
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


async def generate_json(
    *,
    task: str,
    model: str,
    system: str,
    turns: list[ChatTurn],
    schema: type[T],
    temperature: float = 0.7,
) -> T:
    """Generate a JSON object that conforms to `schema`. `task` names the caller for usage logs."""
    client = _get_client()
    started = time.monotonic()
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

    u = res.usage_metadata
    # One structured line per call. cachedTokens is the part of the input Gemini served from its
    # prompt cache at a discount; a usage_ledger table replaces this log in M2.
    print(
        json.dumps(
            {
                "event": "llm.usage",
                "task": task,
                "model": model,
                "ms": round((time.monotonic() - started) * 1000),
                "inputTokens": (u and u.prompt_token_count) or 0,
                "cachedTokens": (u and u.cached_content_token_count) or 0,
                "outputTokens": (u and u.candidates_token_count) or 0,
            }
        ),
        flush=True,
    )
    text = res.text
    if not text:
        raise ApiError(502, "Gemini returned an empty response.")
    try:
        return schema.model_validate_json(text)
    except ValidationError as e:
        raise ApiError(502, f"Gemini returned JSON that does not match the schema ({model}): {e}") from e
