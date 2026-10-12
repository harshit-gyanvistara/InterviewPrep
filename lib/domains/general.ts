import type { DomainProfile } from "./index";

/** Fallback for any profession we don't have a dedicated profile for. The prompts tailor to the role and job description. */
export const general: DomainProfile = {
  id: "general",
  label: "Other / general",
  interviewerContext: "",
  scoringContext: "",
  roundHints:
    "Pick rounds that test the actual skills the job description asks for: technical, case-based, portfolio/design, sales pitch, clinical scenario, teaching demo, whatever fits the role. Do not default to software questions. Do NOT invent a programming/DSA coding round unless the job description explicitly asks for coding.",
  roadmapHints: "This may be for ANY profession; do not assume software/tech unless the role or job description says so.",
  allowsCoding: false,
  version: 1,
};
