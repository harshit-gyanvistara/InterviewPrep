"""The Python prompts must match the TypeScript originals byte for byte.

fixtures/prompts.json was rendered from the Next.js app's lib/prompts.ts by
scripts/export-prompt-fixtures.ts, both removed once the port landed (see git history). Edit a prompt
on purpose? Update the fixture's "expected" text in the same change.
"""

import json
from pathlib import Path

import pytest

from live_agent import prompts
from live_agent.models import AssistRequest, DomainIn, Message, Pack, PersonaIn, Profile, SessionConfig

CASES = json.loads((Path(__file__).parent / "fixtures" / "prompts.json").read_text(encoding="utf-8"))


def render(fn: str, a: dict):
    m = lambda key, model: model.model_validate(a[key])  # noqa: E731
    msgs = lambda: [Message.model_validate(x) for x in a["messages"]]  # noqa: E731
    match fn:
        case "interviewer_system":
            return prompts.interviewer_system(m("pack", Pack), m("config", SessionConfig), m("profile", Profile), m("domain", DomainIn), m("persona", PersonaIn))
        case "scoring_system":
            return prompts.scoring_system(m("pack", Pack), m("config", SessionConfig), m("profile", Profile), m("domain", DomainIn))
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
