from fastapi import APIRouter

from ..gemini import MODELS, generate_json
from ..limits import LIMITS
from ..models import RoadmapRequest, RoadmapResult
from ..prompts import js_json, roadmap_system

router = APIRouter(tags=["roadmap"])


@router.post("/roadmap")
async def roadmap(body: RoadmapRequest) -> RoadmapResult:
    weeks = min(LIMITS.roadmap_weeks_max, max(LIMITS.roadmap_weeks_min, body.weeks or LIMITS.roadmap_weeks_default))
    return await generate_json(
        task="roadmap",
        model=MODELS.chat,
        system=roadmap_system(body.profile, body.domain, weeks),
        turns=[{"role": "user", "text": js_json(body.digests[: LIMITS.roadmap_digests])}],
        temperature=0.5,
        schema=RoadmapResult,
    )
