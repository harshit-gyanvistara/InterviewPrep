from fastapi import APIRouter

from ..gemini import MODELS, generate_json
from ..models import RoadmapRequest, RoadmapResult
from ..prompts import js_json, roadmap_system

router = APIRouter(tags=["roadmap"])


@router.post("/roadmap")
async def roadmap(body: RoadmapRequest) -> RoadmapResult:
    weeks = min(12, max(1, body.weeks or 4))
    return await generate_json(
        task="roadmap",
        model=MODELS.chat,
        system=roadmap_system(body.profile, body.domain, weeks),
        turns=[{"role": "user", "text": js_json(body.digests[:15])}],
        temperature=0.5,
        schema=RoadmapResult,
    )
