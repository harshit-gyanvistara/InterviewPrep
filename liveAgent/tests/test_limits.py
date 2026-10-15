"""Each prompt builder sends at most LIMITS of its input (implementationPlan M1.3).

Inputs are filled with a marker character that appears nowhere in the prompt templates, so counting
it in the output measures exactly how much of the input got through. Route-level caps (transcript,
final code, history, digests, packs) are in test_routes.py.
"""

from live_agent import prompts
from live_agent.limits import LIMITS
from live_agent.models import AssistRequest, DomainIn, Pack, PersonaIn, Profile, SessionConfig

M = "☃"  # ☃
OVER = 500  # characters past each limit

PACK = Pack(title="Behavioural", round_type="behavioural", topics=["Intro"], rubric=["Clarity"])
CODING_PACK = PACK.model_copy(update={"round_type": "coding"})
CONFIG = SessionConfig(persona="neutral", duration_min=20)
DOMAIN = DomainIn(id="general")
PERSONA = PersonaIn(name="Marcus", tone="Calm.")


def long_profile(**fields: int) -> Profile:
    return Profile(target_role="Nurse", **{k: M * n for k, n in fields.items()})


def test_interviewer_prompt_caps_resume_and_job_description():
    # Different lengths per field, so each count is attributable.
    p = long_profile(resume=LIMITS.resume_chars + OVER)
    assert prompts.interviewer_system(PACK, CONFIG, p, DOMAIN, PERSONA).count(M) == LIMITS.resume_chars
    p = long_profile(job_description=LIMITS.job_description_chars + OVER)
    assert prompts.interviewer_system(PACK, CONFIG, p, DOMAIN, PERSONA).count(M) == LIMITS.job_description_chars


def test_scoring_prompt_caps_resume_and_job_description():
    p = long_profile(resume=LIMITS.resume_chars + OVER, job_description=LIMITS.job_description_chars + OVER)
    assert prompts.scoring_system(PACK, CONFIG, p, DOMAIN).count(M) == LIMITS.resume_chars + LIMITS.job_description_chars


def test_pack_gen_prompt_caps_resume_and_job_description():
    p = long_profile(resume=LIMITS.pack_gen_resume_chars + OVER, job_description=LIMITS.pack_gen_job_description_chars + OVER)
    assert prompts.pack_gen_system(p, DOMAIN).count(M) == LIMITS.pack_gen_resume_chars + LIMITS.pack_gen_job_description_chars


def test_roadmap_prompt_caps_job_description():
    p = long_profile(job_description=LIMITS.job_description_chars + OVER)
    assert prompts.roadmap_system(p, DOMAIN, 4).count(M) == LIMITS.job_description_chars


def test_state_note_caps_code():
    state = prompts.interview_state(config=CONFIG, round_type="coding", elapsed_sec=0, interviewer_turns_so_far=1, code=M * (LIMITS.code_chars + OVER))
    assert state.count(M) == LIMITS.code_chars


def test_state_note_wraps_up_inside_the_last_window():
    def note(left: float) -> str:
        return prompts.interview_state(config=CONFIG, round_type="behavioural", elapsed_sec=20 * 60 - left, interviewer_turns_so_far=1, code="")

    assert "time is almost up" in note(LIMITS.wrap_up_sec - 1)
    assert "time is almost up" not in note(LIMITS.wrap_up_sec)


def test_assist_caps_text_to_improve():
    body = AssistRequest(mode="improve", text=M * (LIMITS.assist_text_chars + OVER))
    assert prompts.assist_user_text(body).count(M) == LIMITS.assist_text_chars


def test_recent_window_bounds_history_and_trims_in_steps():
    for n in range(0, LIMITS.history_messages * 3):
        window = prompts.recent_window(list(range(n)))
        assert len(window) <= LIMITS.history_messages
        assert window == list(range(n))[n - len(window) :]  # the newest messages, in order
        # The window's start (part of the cached prefix) only moves in whole steps.
        assert (n - len(window)) % LIMITS.history_step == 0
