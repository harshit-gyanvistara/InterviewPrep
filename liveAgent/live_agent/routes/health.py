import asyncio
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..gemini import MODELS, ApiError, generate_json, has_key
from ..models import HealthOk, ModelCheck, ModelsHealth

router = APIRouter(tags=["health"])


async def _check(model: str) -> ModelCheck:
    started = time.monotonic()
    try:
        await generate_json(
            task="health",
            model=model,
            system='Reply with JSON {"ok": true}.',
            turns=[{"role": "user", "text": "ping"}],
            schema=HealthOk,
            temperature=0,
        )
        return ModelCheck(model=model, ok=True, ms=round((time.monotonic() - started) * 1000))
    except ApiError as e:
        return ModelCheck(model=model, ok=False, ms=round((time.monotonic() - started) * 1000), error=e.message)


@router.get("/health/models", response_model_exclude_none=True, responses={503: {"model": ModelsHealth}})
async def models_health() -> ModelsHealth:
    """Connection test behind Settings -> Data & AI: pings the chat and scoring models."""
    if not has_key():
        body = ModelsHealth(ok=False, hasKey=False, error="GEMINI_API_KEY is not set in liveAgent/.env")
        return JSONResponse(body.model_dump(exclude_none=True), status_code=503)  # type: ignore[return-value]
    chat, scoring = await asyncio.gather(_check(MODELS.chat), _check(MODELS.scoring))
    return ModelsHealth(ok=chat.ok and scoring.ok, hasKey=True, chat=chat, scoring=scoring)
