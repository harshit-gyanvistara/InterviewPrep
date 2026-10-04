import type { DomainProfile } from "./index";

export const software: DomainProfile = {
  id: "software",
  label: "Software / IT",
  match:
    /software|developer|programmer|\bsde\b|full.?stack|backend|front.?end|web dev|data structures|algorithm|devops|\bml\b|machine learning|data scientist|data engineer|qa engineer|sde\d|coding|\bapi\b|embedded|firmware|android|ios app/.source,
  interviewerContext:
    "FIELD: Software engineering. Technical questions test reasoning, trade-offs and complexity, not trivia. Ask the candidate to think aloud and justify design choices.",
  scoringContext: "- Software: credit correct reasoning about complexity and trade-offs over memorised definitions.",
  roundHints:
    "This role is technical/software-related, so it is fine to include a coding or CS-fundamentals-style round if the job description supports it, alongside a behavioural or screening round.",
  roadmapHints: "Include DSA practice, CS fundamentals and project deep-dives where the role needs them.",
  allowsCoding: true,
  version: 1,
};
