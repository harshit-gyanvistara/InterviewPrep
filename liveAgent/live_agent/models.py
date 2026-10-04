"""Request/response contract for the AI service.

These models are the single source of truth for the Core <-> liveAgent API. FastAPI publishes them
as openapi.json, and the Next.js app generates lib/liveAgent.types.ts from that file.

Two kinds of models live here:
- API models (subclass `ApiModel`): camelCase on the wire, unknown fields ignored, so Core can send
  its full objects (a Profile with id/createdAt/...) without the AI service caring.
- LLM output models (plain `BaseModel`): field names are exactly the JSON keys Gemini must return,
  so the response schema has no aliasing. They are also the API responses.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Persona = Literal["friendly", "neutral", "tough"]
RoundType = Literal["behavioural", "technical", "coding", "hr"]
Number = int | float


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ---------- shared inputs ----------


class Profile(ApiModel):
    name: str = ""
    target_role: str = ""
    target_companies: str = ""
    job_description: str = ""
    experience: str = ""
    resume: str = ""


class Pack(ApiModel):
    title: str
    company: str = ""
    role: str = ""
    round_type: RoundType
    description: str = ""
    topics: list[str] = Field(min_length=1)
    rubric: list[str] = Field(min_length=1)
    style: str = ""


class SessionConfig(ApiModel):
    persona: Persona
    duration_min: Number
    pressure: bool = False
    question_count: Number | None = None


class Message(ApiModel):
    role: Literal["interviewer", "candidate"]
    text: str


class PersonaIn(ApiModel):
    """The interviewer persona, resolved by Core from its PERSONAS table."""

    name: str
    tone: str


class DomainIn(ApiModel):
    """The field profile (lib/domains in Core), resolved by Core from the catalog."""

    id: str
    interviewer_context: str = ""
    scoring_context: str = ""
    round_hints: str = ""
    roadmap_hints: str = ""
    version: int = 1


# ---------- requests ----------


class TurnRequest(ApiModel):
    config: SessionConfig
    profile: Profile
    pack: Pack
    persona: PersonaIn
    domain: DomainIn
    messages: list[Message] = []
    elapsed_sec: Number = 0
    code: str = ""


class ReportRequest(ApiModel):
    config: SessionConfig
    profile: Profile
    pack: Pack
    domain: DomainIn
    interviewer_name: str
    messages: list[Message] = []
    code: str = ""


class PackGenerateRequest(ApiModel):
    profile: Profile
    domain: DomainIn


class RoadmapRequest(ApiModel):
    profile: Profile
    domain: DomainIn
    weeks: Number | None = None
    # Passed to the model verbatim as JSON, so kept as raw objects (key order and values preserved).
    digests: list[dict[str, Any]] = []


class AssistRequest(ApiModel):
    mode: Literal["improve", "generate"]
    text: str | None = None
    instruction: str | None = None
    context_title: str | None = None


# ---------- LLM outputs / responses ----------


class TurnResult(BaseModel):
    reply: str
    endInterview: bool


class DimensionScore(BaseModel):
    name: str
    score: float
    evidence: str
    feedback: str


class AnswerReview(BaseModel):
    question: str
    answerSummary: str
    score: float
    feedback: str
    betterAnswer: str
    expectedAnswer: str


class ReportResult(BaseModel):
    overall: float
    verdict: Literal["Strong Hire", "Hire", "Borderline", "Not Yet"]
    summary: str
    strengths: list[str]
    topFixes: list[str]
    dimensions: list[DimensionScore]
    answerReviews: list[AnswerReview]


class GeneratedPack(BaseModel):
    title: str
    company: str
    role: str
    roundType: RoundType
    description: str
    durationMin: float
    topics: list[str]
    rubric: list[str]
    style: str


class PacksResult(BaseModel):
    packs: list[GeneratedPack]


class RoadmapItem(BaseModel):
    week: float
    title: str
    detail: str
    focus: str


class RoadmapResult(BaseModel):
    summary: str
    items: list[RoadmapItem]


class AssistResult(BaseModel):
    html: str


class HealthOk(BaseModel):
    ok: bool


class ModelCheck(BaseModel):
    model: str
    ok: bool
    ms: int
    error: str | None = None


class ModelsHealth(BaseModel):
    ok: bool
    hasKey: bool
    error: str | None = None
    chat: ModelCheck | None = None
    scoring: ModelCheck | None = None


class ErrorBody(BaseModel):
    error: str
