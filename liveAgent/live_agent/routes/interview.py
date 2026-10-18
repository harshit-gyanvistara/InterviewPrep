from fastapi import APIRouter, Response

from ..gemini import MODELS, ApiError, generate_json
from ..limits import LIMITS
from ..scoring import apply_rules, coverage
from ..models import ReportRequest, ReportResult, ScoredReport, TurnRequest, TurnResult
from ..prompts import PROMPT_VERSIONS, interview_state, interviewer_system, recent_window, scoring_system, to_turns, transcript_text

router = APIRouter(prefix="/interview", tags=["interview"])


@router.post("/turn")
async def turn(body: TurnRequest, response: Response) -> TurnResult:
    response.headers["X-Prompt-Version"] = PROMPT_VERSIONS["interview.turn"]
    state = interview_state(
        config=body.config,
        round_type=body.pack.round_type,
        elapsed_sec=body.elapsed_sec,
        interviewer_turns_so_far=sum(1 for m in body.messages if m.role == "interviewer"),
        code=body.code,
    )
    return await generate_json(
        task="interview.turn",
        model=MODELS.chat,
        # Static for the whole session (cacheable); the per-turn state rides on the newest message.
        system=interviewer_system(body.pack, body.config, body.profile, body.domain, body.persona),
        turns=to_turns(recent_window(body.messages), state),
        temperature=0.8 if body.config.persona == "tough" else 0.7,
        schema=TurnResult,
    )


@router.post("/report")
async def report(body: ReportRequest, response: Response) -> ReportResult:
    response.headers["X-Prompt-Version"] = PROMPT_VERSIONS["interview.report"]
    if not any(m.role == "candidate" for m in body.messages):
        raise ApiError(422, "No candidate answers to evaluate.")

    transcript = transcript_text(body.messages, body.profile.name, body.interviewer_name)
    if body.code.strip():
        transcript += f"\n\n[FINAL CODE IN EDITOR]\n{body.code[: LIMITS.code_chars]}"

    cov = coverage(body.config, body.messages)
    scored = await generate_json(
        task="interview.report",
        model=MODELS.scoring,
        system=scoring_system(body.pack, body.config, body.profile, body.domain, cov),
        turns=[{"role": "user", "text": f"TRANSCRIPT\n{transcript[: LIMITS.transcript_chars]}"}],
        temperature=0.2,
        schema=ScoredReport,
    )
    return apply_rules(scored, cov)
