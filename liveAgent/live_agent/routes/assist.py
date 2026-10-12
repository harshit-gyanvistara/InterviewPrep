from fastapi import APIRouter

from ..gemini import MODELS, ApiError, generate_json
from ..models import AssistRequest, AssistResult
from ..prompts import assist_system, assist_user_text

router = APIRouter(tags=["assist"])


@router.post("/assist")
async def assist(body: AssistRequest) -> AssistResult:
    """Writing assist for the Notes drawer and the Cortex notebook. "improve" tidies existing content;
    "generate" drafts new content. Always returns HTML limited to tags both editors render."""
    if body.mode == "improve" and not (body.text or "").strip():
        raise ApiError(400, "Nothing to improve yet — write something first.")
    if body.mode == "generate" and not (body.instruction or "").strip() and not (body.context_title or "").strip():
        raise ApiError(400, "Say what you'd like written.")
    return await generate_json(
        task="ai.assist",
        model=MODELS.chat,
        system=assist_system(body),
        turns=[{"role": "user", "text": assist_user_text(body)}],
        temperature=0.4 if body.mode == "improve" else 0.7,
        schema=AssistResult,
    )
