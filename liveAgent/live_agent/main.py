"""liveAgent: Offerly's AI service.

Core (the Next.js app) is the only caller. It authenticates users, resolves the field profile and
persona, and sends everything a call needs; this service holds no user data. Every /v1 route needs
`Authorization: Bearer $LIVE_AGENT_TOKEN`.
"""

import hmac
import os

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .gemini import ApiError
from .models import ErrorBody
from .routes import assist, health, interview, packs, roadmap


def require_core(request: Request) -> None:
    expected = os.environ.get("LIVE_AGENT_TOKEN")
    if not expected:
        raise ApiError(503, "LIVE_AGENT_TOKEN is not set on the AI service.")
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise ApiError(401, "Unauthorized.")


app = FastAPI(
    title="liveAgent",
    version="1.0.0",
    description="Offerly AI service. Called only by Core.",
    responses={400: {"model": ErrorBody}, 401: {"model": ErrorBody}, 502: {"model": ErrorBody}, 503: {"model": ErrorBody}},
)

v1 = APIRouter(prefix="/v1", dependencies=[Depends(require_core)])
for module in (interview, packs, roadmap, assist, health):
    v1.include_router(module.router)
app.include_router(v1)


@app.get("/healthz", tags=["health"])
def healthz() -> dict[str, bool]:
    """Liveness for the platform (no auth, no Gemini call)."""
    return {"ok": True}


# The error shape the browser already handles: {"error": message} with an HTTP status.
@app.exception_handler(ApiError)
async def api_error(_: Request, e: ApiError) -> JSONResponse:
    return JSONResponse({"error": e.message}, status_code=e.status)


INVALID = {
    "/v1/interview/turn": "Invalid interview configuration.",
    "/v1/interview/report": "Invalid report request.",
    "/v1/packs/generate": "Missing target role.",
    "/v1/roadmap": "Missing profile.",
}


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, e: RequestValidationError) -> JSONResponse:
    errors = e.errors()
    first = errors[0] if errors else {}
    where = ".".join(str(p) for p in first.get("loc", ())[1:])
    detail = f" ({where}: {first.get('msg')})" if where else ""
    return JSONResponse({"error": INVALID.get(request.url.path, "Invalid request.") + detail}, status_code=400)


@app.exception_handler(Exception)
async def unexpected(_: Request, e: Exception) -> JSONResponse:
    return JSONResponse({"error": str(e) or "Unknown error"}, status_code=500)
