import type { ShareLevel } from "./permissions";
import type { StudentField } from "./orgSettings";
import type { RoundType } from "./types";

// Client-safe. Starter kits (plans/b2b-college.md B.7): a ready set of rounds, plans and settings a new
// organisation starts from. Applying a kit COPIES it into the org (its rounds become the org's own, its
// plans the org's own), so a college's edits never change the kit or another college. Kits live in
// code, like lib/domains and lib/packs; bump `version` when one changes.

export interface KitRound {
  /** Local name the kit's plans use to point at this round. */
  key: string;
  title: string;
  company: string;
  role: string;
  roundType: RoundType;
  description: string;
  durationMin: number;
  topics: string[];
  rubric: string[];
  style: string;
}

export interface KitStage {
  title: string;
  /** A `key` from this kit's rounds. */
  round: string;
  targetCount: number;
  /** Days after the plan is given out. */
  dueDays: number | null;
  /** Score a mock must reach to count. */
  gateScore: number | null;
  mandatory: boolean;
}

export interface KitPlan {
  name: string;
  description: string;
  stages: KitStage[];
}

export interface StarterKit {
  id: string;
  version: number;
  name: string;
  /** Org kind this suits (organizations.kind). */
  kind: string;
  description: string;
  /** Settings the kit sets, only where the org hasn't set them already. */
  settings: { studentFields?: StudentField[]; minShareLevel?: ShareLevel; defaultShareLevel?: ShareLevel };
  rounds: KitRound[];
  plans: KitPlan[];
}

export const COLLEGE_PLACEMENT: StarterKit = {
  id: "college-placement",
  version: 1,
  name: "College placement",
  kind: "college",
  description: "Five campus-placement rounds (HR, behavioural, technical, coding, final mock) and two plans: an 8-week programme and a 2-week crash course. Asks students for branch and graduation year, and asks them to share scores with the placement cell.",
  settings: {
    studentFields: [
      { key: "branch", label: "Branch", required: true },
      { key: "graduation_year", label: "Graduation year", required: true },
      { key: "roll_number", label: "Roll number", required: false },
    ],
    minShareLevel: "scores",
    defaultShareLevel: "scores",
  },
  rounds: [
    {
      key: "intro-hr",
      title: "Campus HR Screening",
      company: "Campus recruiters",
      role: "Graduate trainee",
      roundType: "hr",
      description: "The first-round HR conversation at campus drives: introduction, background, strengths, and why this company.",
      durationMin: 15,
      topics: [
        "Tell me about yourself",
        "Your family, education and why you chose your branch",
        "Strengths and weaknesses, with an example of each",
        "Why this company, and why this role",
        "Willingness to relocate, work in shifts and learn new skills",
        "Where do you see yourself in three years",
      ],
      rubric: ["Clarity and confidence", "Honesty and self-awareness", "Company knowledge", "Communication", "Attitude"],
      style: "Polite and brisk, like a campus HR panel. Short questions; follow up when an answer is vague or rehearsed.",
    },
    {
      key: "behavioural-star",
      title: "Campus Behavioural (STAR)",
      company: "Campus recruiters",
      role: "Graduate trainee",
      roundType: "behavioural",
      description: "Stories from projects, internships and campus life, answered in STAR form: teamwork, deadlines, failure and leadership.",
      durationMin: 20,
      topics: [
        "A project you are proud of and exactly what you did in it",
        "A disagreement in a team and how it was resolved",
        "A time you missed a deadline or something went wrong",
        "A time you led others or took initiative, in a club, event or project",
        "Something you had to learn quickly",
        "Feedback you received and what you changed",
      ],
      rubric: ["Structure (STAR)", "Personal contribution", "Impact and results", "Reflection", "Communication"],
      style: "Friendly but probing. Ask what the student personally did, what the result was, and what they would change.",
    },
    {
      key: "technical-core",
      title: "Technical Fundamentals",
      company: "Campus recruiters",
      role: "Graduate engineer",
      roundType: "technical",
      description: "Core concepts from the student's own branch and projects, with a few why-and-how follow-ups on each.",
      durationMin: 30,
      topics: [
        "Walk through your main project: design choices, trade-offs and what you would improve",
        "Core subjects from your branch: basic concepts explained simply, then one level deeper",
        "Debugging: how you find and fix a problem you cannot immediately explain",
        "A concept you listed on your resume, tested with a practical scenario",
        "Basic problem solving: reason aloud through a small scenario",
      ],
      rubric: ["Technical accuracy", "Depth of understanding", "Problem-solving approach", "Clear explanation", "Honesty about gaps"],
      style: "Start simple and go deeper if the answer is solid. Ask why and how, not only what. Accept 'I don't know' but ask how they would find out.",
    },
    {
      key: "coding-screen",
      title: "Coding Screen",
      company: "Campus recruiters",
      role: "Graduate engineer",
      roundType: "coding",
      description: "Two small programming problems: reason out loud, write the solution, then test it and discuss complexity.",
      durationMin: 30,
      topics: [
        "A string or array problem solved first the simple way, then improved",
        "A problem using a hash map, stack or queue",
        "Reading a short piece of code and finding the bug",
        "Time and space complexity of what you wrote",
      ],
      rubric: ["Correctness", "Problem decomposition", "Code clarity", "Complexity analysis", "Testing and edge cases"],
      style: "Ask the candidate to talk through their approach before coding. Nudge with hints if stuck, and note how much help was needed.",
    },
    {
      key: "final-mock",
      title: "Final Mock Interview",
      company: "Campus recruiters",
      role: "Graduate trainee",
      roundType: "behavioural",
      description: "A full mixed interview like a real campus final round: introduction, project, a technical probe and fit questions.",
      durationMin: 30,
      topics: [
        "Introduce yourself in a minute",
        "Your strongest project, with follow-up questions on how it works",
        "One or two technical questions from your branch",
        "A situation showing teamwork or ownership",
        "Why us, why now, and your questions for the interviewer",
      ],
      rubric: ["Overall impression", "Technical credibility", "Structure and clarity", "Ownership and impact", "Role fit"],
      style: "Behave like a real final-round interviewer: courteous, time-aware, and willing to challenge a weak answer once.",
    },
  ],
  plans: [
    {
      name: "Campus placement, 8 weeks",
      description: "From first practice to final mock. Each stage unlocks the next; reach the score to count a mock.",
      stages: [
        { title: "HR screening", round: "intro-hr", targetCount: 1, dueDays: 14, gateScore: 55, mandatory: true },
        { title: "Behavioural stories", round: "behavioural-star", targetCount: 1, dueDays: 28, gateScore: 60, mandatory: true },
        { title: "Technical fundamentals", round: "technical-core", targetCount: 2, dueDays: 42, gateScore: 60, mandatory: true },
        { title: "Coding screen", round: "coding-screen", targetCount: 1, dueDays: 49, gateScore: 60, mandatory: false },
        { title: "Final mock", round: "final-mock", targetCount: 1, dueDays: 56, gateScore: 70, mandatory: true },
      ],
    },
    {
      name: "Crash course, 2 weeks",
      description: "A short plan for students close to a drive.",
      stages: [
        { title: "HR screening", round: "intro-hr", targetCount: 1, dueDays: 5, gateScore: null, mandatory: true },
        { title: "Technical fundamentals", round: "technical-core", targetCount: 1, dueDays: 10, gateScore: null, mandatory: true },
        { title: "Final mock", round: "final-mock", targetCount: 1, dueDays: 14, gateScore: 60, mandatory: true },
      ],
    },
  ],
};

export const STARTER_KITS: StarterKit[] = [COLLEGE_PLACEMENT];

export const kitById = (id: string) => STARTER_KITS.find((k) => k.id === id);

/** Problems with a kit's own wiring (a plan naming a round it doesn't have, bad numbers). Empty when sound. */
export function kitProblems(kit: StarterKit): string[] {
  const out: string[] = [];
  const keys = new Set(kit.rounds.map((r) => r.key));
  if (keys.size !== kit.rounds.length) out.push("duplicate round keys");
  for (const r of kit.rounds) {
    if (r.durationMin < 5 || r.durationMin > 120) out.push(`${r.key}: duration`);
    if (!r.title.trim() || !r.topics.length || !r.rubric.length) out.push(`${r.key}: empty title, topics or rubric`);
  }
  for (const p of kit.plans) {
    if (!p.stages.length || p.stages.length > 12) out.push(`${p.name}: stage count`);
    for (const s of p.stages) {
      if (!keys.has(s.round)) out.push(`${p.name} / ${s.title}: unknown round ${s.round}`);
      if (s.gateScore !== null && (s.gateScore < 0 || s.gateScore > 100)) out.push(`${p.name} / ${s.title}: gate`);
      if (s.targetCount < 1 || s.targetCount > 50) out.push(`${p.name} / ${s.title}: count`);
    }
  }
  return out;
}
