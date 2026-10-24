"""How much of each input reaches the model (implementationPlan M1.3).

Every truncation and cap in prompt construction reads from here, so changing one is a one-line edit
and tests/test_limits.py proves the prompts respect it. These are cost and context limits, tighter
than Core's request caps (LIMITS in lib/schemas.ts), which only guard against abuse; keep each one
below the matching Core cap or the cut happens there first, with a 400.

Changing a value changes prompts: the interviewer prompt is the cached prefix, so a change resets
Gemini's cache for running sessions, and tests/fixtures/prompts.json may need its expected text
updated.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Limits:
    # Characters of candidate context in the interviewer and scoring prompts.
    resume_chars: int = 6000
    job_description_chars: int = 4000
    # Pack generation leans on the job description, so it gets more of it and less resume.
    pack_gen_job_description_chars: int = 8000
    pack_gen_resume_chars: int = 4000
    # Each field of the organisation's context (companies, roles, tech stack, notes).
    org_context_chars: int = 1500
    # Code editor contents, in the per-turn STATE note and in the scored transcript.
    code_chars: int = 6000
    # The whole transcript sent for scoring.
    transcript_chars: int = 40_000
    # Interview history sent per turn: the last `history_messages`, trimmed `history_step` at a
    # time so the cached prefix stays unchanged between trims (prompts.recent_window).
    history_messages: int = 60
    history_step: int = 20
    # Seconds left at which the STATE note tells the interviewer to wrap up.
    wrap_up_sec: int = 90
    # Notes sent to the writing assist in "improve" mode.
    assist_text_chars: int = 12_000
    # Most recent report digests the roadmap is built from.
    roadmap_digests: int = 15
    roadmap_weeks_min: int = 1
    roadmap_weeks_max: int = 12
    roadmap_weeks_default: int = 4
    # Generated packs returned per request.
    generated_packs: int = 3


LIMITS = Limits()
