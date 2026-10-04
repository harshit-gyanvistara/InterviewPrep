from fastapi import APIRouter

from ..gemini import MODELS, ApiError, generate_json
from ..models import PackGenerateRequest, PacksResult
from ..prompts import pack_gen_system

router = APIRouter(prefix="/packs", tags=["packs"])


@router.post("/generate")
async def generate(body: PackGenerateRequest) -> PacksResult:
    """Builds a small set of interview rounds tailored to the candidate's exact target role and job
    description, so the app works for any profession rather than a fixed list of tech rounds."""
    if not body.profile.target_role.strip():
        raise ApiError(400, "Missing target role.")
    out = await generate_json(
        task="pack.generate",
        model=MODELS.scoring,
        system=pack_gen_system(body.profile, body.domain),
        turns=[{"role": "user", "text": "Generate the rounds now."}],
        temperature=0.6,
        schema=PacksResult,
    )
    if not out.packs:
        raise ApiError(502, "Could not generate interview rounds. Try again.")
    return PacksResult(packs=out.packs[:3])
