import type { Pack, Persona, Profile } from "./types";

/**
 * Built-in round library. Kept small and mostly role-agnostic — the interviewer prompt
 * (see prompts.ts) already tailors every round to the candidate's own target role, resume
 * and job description, so these are shapes ("a behavioural round", "an HR screen"), not
 * job titles. The two CS-specific rounds are only shown to candidates who look technical
 * (see isTechnical below); every other profession is served by the universal rounds plus
 * whatever gets generated from their job description (see /api/pack/generate).
 */
export const PACKS: Pack[] = [
  {
    id: "behavioural",
    title: "Behavioural Interview",
    company: "Any employer",
    role: "Any role",
    roundType: "behavioural",
    domains: "all",
    description: "Projects, teamwork, conflict, failure and ownership stories. Expect STAR-style follow-ups.",
    durationMin: 15,
    topics: [
      "Introduce yourself",
      "Your most challenging piece of work and your exact contribution",
      "A conflict or disagreement with a teammate, manager or client",
      "A failure and what you learned",
      "A time you took ownership without being asked",
      "Why this role and this organisation",
    ],
    rubric: ["Structure (STAR)", "Ownership and impact", "Communication", "Self-awareness", "Role fit"],
    style: "Probe for specifics: numbers, your personal role, what you would do differently.",
  },
  {
    id: "hr-screen",
    title: "HR / Screening Round",
    company: "Any employer",
    role: "Any role",
    roundType: "hr",
    domains: "all",
    description: "Self-introduction, strengths/weaknesses, availability, and why this organisation. Common as a first-round screen everywhere.",
    durationMin: 10,
    topics: [
      "Tell me about yourself",
      "Strengths and weaknesses",
      "Why this organisation and this role",
      "Availability, relocation and willingness to learn",
      "Where do you see yourself in five years",
      "Do you have any questions for us",
    ],
    rubric: ["Clarity and confidence", "Attitude", "Organisation knowledge", "Communication", "Consistency"],
    style: "Brisk and formal. Short questions, expect crisp answers.",
  },
  {
    id: "leadership-ownership",
    title: "Ownership & Leadership Round",
    company: "Any employer (Amazon-style)",
    role: "Any role",
    roundType: "behavioural",
    domains: "all",
    description: "Deep behavioural probing on ownership, customer focus, judgement under ambiguity and learning from mistakes.",
    durationMin: 25,
    topics: [
      "A time you put the customer or user first",
      "A time you owned a problem end to end",
      "A decision you made under ambiguity with limited information",
      "Going deep on the details of something you worked on",
      "A time you disagreed with a decision and how you handled it",
    ],
    rubric: ["Ownership", "Depth and specifics (data)", "Personal contribution ('I' not 'we')", "Structure", "Learning"],
    style: "Very strict follow-ups: 'What exactly did YOU do?', 'What was the result in numbers?', 'What would you change?'. Do not accept vague answers.",
  },
  {
    id: "case-study",
    title: "Case Study & Judgement Round",
    company: "Any employer (consulting/business style)",
    role: "Business, strategy, product, finance or operations roles",
    roundType: "technical",
    domains: "all",
    description: "A business problem or scenario to reason through out loud: framing, structure, trade-offs and a recommendation.",
    durationMin: 20,
    topics: [
      "Clarify the problem and lay out a structure before answering",
      "A market-sizing or estimation question",
      "A scenario needing a recommendation with trade-offs",
      "Basic quantitative reasoning (percentages, unit economics, a simple P&L)",
      "Defending the recommendation against pushback",
    ],
    rubric: ["Structuring", "Quantitative reasoning", "Business judgement", "Communication", "Handling pushback"],
    style: "Give a short scenario, let the candidate structure it aloud before jumping to an answer, push back on the first recommendation.",
  },
  {
    id: "group-discussion",
    title: "Group Discussion Round",
    company: "Any employer",
    role: "Any role",
    roundType: "hr",
    domains: "all",
    description: "A single AI panel plays multiple voices in a discussion. Tests how you build on others, disagree respectfully and stay concise.",
    durationMin: 15,
    topics: [
      "Opening position on the topic",
      "Responding to a conflicting viewpoint",
      "Bringing in a quiet participant's angle",
      "Summarising and closing the discussion",
    ],
    rubric: ["Clarity of argument", "Listening and building on others", "Assertiveness without dominating", "Structure"],
    style: "Play 2-3 distinct voices in the discussion (skeptic, agreeable, tangential) as well as the moderator. Give the candidate space to speak.",
  },
  {
    id: "cs-fundamentals",
    title: "Technical Fundamentals (CS)",
    company: "Product / service company",
    role: "Software / IT roles",
    roundType: "technical",
    domains: "technical",
    description: "DSA concepts, OOP, DBMS, OS, networking and a discussion of your project's design.",
    durationMin: 20,
    topics: [
      "Project deep-dive: architecture and trade-offs",
      "Data structures: arrays, hash maps, trees, complexity",
      "OOP principles with examples",
      "DBMS: normalisation, indexing, transactions, joins",
      "OS: processes vs threads, deadlocks, memory",
      "Networking: what happens when you type a URL",
    ],
    rubric: ["Technical correctness", "Depth of understanding", "Problem solving", "Communication", "Project ownership"],
    style: "Ask 'why' and 'what if' chains. Start easy, raise difficulty if answers are strong.",
  },
  {
    id: "live-coding",
    title: "Live Coding Round",
    company: "Product company",
    role: "Software / IT roles",
    roundType: "coding",
    domains: "technical",
    description: "One or two DSA problems. Think aloud, write code in the editor, discuss complexity and edge cases.",
    durationMin: 30,
    topics: ["Warm-up array/string problem", "Medium problem (hash map, two pointers, or tree/graph traversal)", "Complexity analysis", "Edge cases and testing"],
    rubric: ["Problem solving", "Code quality", "Complexity analysis", "Testing and edge cases", "Communication while coding"],
    style: "State the problem clearly, let the candidate think aloud, give hints only after they are stuck. Read the code they paste in the editor and ask about it.",
  },
];

export const BASELINE_PACK_ID = "behavioural";

/** Heuristic: does this profile look like a software/technical role? Drives whether the CS-specific rounds show up. */
export function isTechnical(profile: Pick<Profile, "targetRole" | "jobDescription">): boolean {
  const text = `${profile.targetRole} ${profile.jobDescription}`.toLowerCase();
  return /software|developer|programmer|\bsde\b|full.?stack|backend|front.?end|web dev|data structures|algorithm|devops|\bml\b|machine learning|data scientist|data engineer|qa engineer|sde\d|coding|\bapi\b|embedded|firmware|android|ios app/i.test(
    text,
  );
}

/** The built-in packs relevant to this profile (universal ones always, technical ones only for technical profiles). */
export function visibleBuiltInPacks(profile: Pick<Profile, "targetRole" | "jobDescription">): Pack[] {
  const tech = isTechnical(profile);
  return PACKS.filter((p) => p.domains === "all" || tech);
}

export const getPack = (id: string) => PACKS.find((p) => p.id === id);

const dedupe = (items: string[], limit: number) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item.trim());
    }
    if (out.length >= limit) break;
  }
  return out;
};

/**
 * Assembles a single mock round out of one or more existing packs, for the Quick Mock builder.
 * The caller is responsible for turning this into a real Pack (assigning id/source/createdAt)
 * and persisting it, same as a job-description-generated pack.
 */
export function buildMixedPack(selected: Pack[], opts: { questionCount: number; durationMin: number }): Omit<Pack, "id" | "source" | "createdAt"> {
  if (selected.length === 0) throw new Error("Select at least one round to build a Quick Mock.");
  const includesCoding = selected.some((p) => p.roundType === "coding");
  const names = selected.map((p) => p.title);

  return {
    title: selected.length > 1 ? `Quick Mock — ${names.join(" + ")}` : `Quick Mock — ${names[0]}`,
    company: selected[0].company,
    role: selected[0].role,
    // A mixed session shows the code editor throughout if any component round is a coding round —
    // this app doesn't switch the UI mid-session, so a coding round in the mix means the whole
    // session runs with the editor available.
    roundType: includesCoding ? "coding" : selected[0].roundType,
    domains: "all",
    description:
      selected.length > 1
        ? `A quick mixed mock combining ${names.join(", ")} — about ${opts.questionCount} questions in ${opts.durationMin} minutes.`
        : `A quick ${opts.questionCount}-question, ${opts.durationMin}-minute version of ${names[0]}.`,
    durationMin: opts.durationMin,
    topics: dedupe(selected.flatMap((p) => p.topics), Math.max(opts.questionCount * 2, 8)),
    rubric: dedupe(selected.flatMap((p) => p.rubric), 6),
    style:
      selected.length > 1
        ? `This is a mixed session covering several round types — vary your questioning style to match each topic's origin. ${selected.map((p) => `For ${p.title.toLowerCase()}-style topics: ${p.style}`).join(" ")}`
        : selected[0].style,
  };
}

export const PERSONAS: Record<Persona, { label: string; name: string; blurb: string; tone: string }> = {
  friendly: {
    label: "Friendly",
    name: "Isabella",
    blurb: "Warm and encouraging. Good for building confidence.",
    tone: "Warm, encouraging, gives the candidate time. Gentle follow-ups. Still honest.",
  },
  neutral: {
    label: "Neutral",
    name: "Liam",
    blurb: "Professional and even-handed, like most real interviews.",
    tone: "Professional and neutral. No praise, no hostility. Follow-ups when answers are thin.",
  },
  tough: {
    label: "Tough",
    name: "Marcus",
    blurb: "Skeptical, time-pressured, pushes back.",
    tone: "Skeptical and slightly impatient. Challenge weak claims, interrupt rambling politely ('Let me stop you there'), ask 'why' repeatedly, never give free hints.",
  },
};
