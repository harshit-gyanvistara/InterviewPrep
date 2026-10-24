"""The Python prompts must match the TypeScript originals byte for byte.

Since the port, prompts change here first: scoring prompts gained COVERAGE (plans/honest-scoring.md).
fixtures/prompts.json was rendered from the Next.js app's lib/prompts.ts by
scripts/export-prompt-fixtures.ts, both removed once the port landed (see git history). Edit a prompt
on purpose? Update the fixture's "expected" text in the same change.
"""

import json
from pathlib import Path

import pytest

from live_agent import prompts
from live_agent.models import AssistRequest, Coverage, DomainIn, Message, Pack, PersonaIn, Profile, SessionConfig

CASES = json.loads((Path(__file__).parent / "fixtures" / "prompts.json").read_text(encoding="utf-8"))


def render(fn: str, a: dict):
    m = lambda key, model: model.model_validate(a[key])  # noqa: E731
    msgs = lambda: [Message.model_validate(x) for x in a["messages"]]  # noqa: E731
    match fn:
        case "interviewer_system":
            return prompts.interviewer_system(m("pack", Pack), m("config", SessionConfig), m("profile", Profile), m("domain", DomainIn), m("persona", PersonaIn))
        case "scoring_system":
            return prompts.scoring_system(m("pack", Pack), m("config", SessionConfig), m("profile", Profile), m("domain", DomainIn), m("coverage", Coverage))
        case "interview_state":
            return prompts.interview_state(
                config=m("config", SessionConfig),
                round_type=a["roundType"],
                elapsed_sec=a["elapsedSec"],
                interviewer_turns_so_far=a["interviewerTurnsSoFar"],
                code=a["code"],
            )
        case "recent_window":
            return prompts.recent_window(a["messages"])
        case "to_turns":
            return prompts.to_turns(msgs(), a.get("state"))
        case "transcript_text":
            return prompts.transcript_text(msgs(), a["name"], a["interviewer"])
        case "roadmap_system":
            return prompts.roadmap_system(m("profile", Profile), m("domain", DomainIn), a["weeks"])
        case "pack_gen_system":
            return prompts.pack_gen_system(m("profile", Profile), m("domain", DomainIn))
        case "assist_system":
            return prompts.assist_system(m("body", AssistRequest))
        case "assist_user_text":
            return prompts.assist_user_text(m("body", AssistRequest))
    raise AssertionError(f"unknown fixture fn {fn}")


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_prompt_matches_typescript(case):
    assert render(case["fn"], case["args"]) == case["expected"]


# ---------- organisation context (plans/b2b-college.md B.8) ----------

from live_agent.models import OrgContext  # noqa: E402

_PACK = Pack.model_validate({"title": "HR", "company": "Any", "role": "Trainee", "roundType": "hr", "topics": ["t"], "rubric": ["r"], "style": "s"})
_CONFIG = SessionConfig.model_validate({"persona": "neutral", "durationMin": 15})
_PROFILE = Profile.model_validate({"name": "Asha", "targetRole": "Engineer"})
_DOMAIN = DomainIn.model_validate({"id": "general", "interviewerContext": "", "scoringContext": "", "roundHints": "", "roadmapHints": "", "version": 1})
_PERSONA = PersonaIn.model_validate({"name": "Priya", "tone": "warm"})
_COV = Coverage.model_validate({"answered": 3, "expected": 5, "sufficient": True})


def test_no_org_context_leaves_prompts_exactly_as_before():
    plain_i = prompts.interviewer_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _PERSONA)
    plain_s = prompts.scoring_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _COV)
    assert prompts.interviewer_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _PERSONA, None) == plain_i
    assert prompts.scoring_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _COV, None) == plain_s
    # A context with nothing in it adds nothing either, and "ORGANISATION CONTEXT" never appears.
    empty = OrgContext.model_validate({"orgName": "Sunrise"})
    assert prompts.interviewer_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _PERSONA, empty) == plain_i
    assert "ORGANISATION CONTEXT" not in plain_i + plain_s


def test_org_context_is_added_before_the_candidate_and_only_the_filled_lines():
    ctx = OrgContext.model_validate({"orgName": "Sunrise College", "companies": "TCS, Infosys", "techStack": "Java, SQL"})
    text = prompts.interviewer_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _PERSONA, ctx)
    assert "ORGANISATION CONTEXT (the candidate is practising for Sunrise College)" in text
    assert "- Companies it prepares people for: TCS, Infosys" in text
    assert "- Tech stack and tools: Java, SQL" in text
    assert "Roles it prepares people for" not in text and "Notes from the organisation" not in text
    assert text.index("ORGANISATION CONTEXT") < text.index("CANDIDATE\n")
    assert "Never read it out" in text


def test_scoring_gets_the_judging_wording_and_is_stable_for_a_session():
    ctx = OrgContext.model_validate({"orgName": "Sunrise", "notes": "Weigh communication heavily."})
    a = prompts.scoring_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _COV, ctx)
    b = prompts.scoring_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _COV, ctx)
    assert a == b
    assert "When judging, weigh the answers" in a and "Never read it out" not in a
    assert "- Notes from the organisation: Weigh communication heavily." in a


def test_org_context_fields_are_capped():
    ctx = OrgContext.model_validate({"orgName": "S", "notes": "x" * 10_000})
    text = prompts.interviewer_system(_PACK, _CONFIG, _PROFILE, _DOMAIN, _PERSONA, ctx)
    assert "x" * 1500 in text and "x" * 1501 not in text
