export type Persona = "friendly" | "neutral" | "tough";
export type RoundType = "behavioural" | "technical" | "coding" | "hr";

export interface Profile {
  id: string;
  name: string;
  targetRole: string;
  targetCompanies: string;
  jobDescription: string;
  experience: "student" | "fresher" | "0-1y" | "1-3y";
  resume: string;
  interviewDate?: string; // YYYY-MM-DD
  weeklyGoal: number;
  onboarded: boolean;
  createdAt: number;
}

export interface Settings {
  id: "settings";
  defaultPersona: Persona;
  defaultDuration: number | null; // null = use the pack's own duration
  defaultPressure: boolean;
  showTimer: boolean;
  confirmEnd: boolean;
  voiceReply: boolean;
  autoListen: boolean;
  voiceName: string; // "" = auto
  speechRate: number;
  recognitionLang: string;
  captions: boolean;
  cameraDefault: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  defaultPersona: "neutral",
  defaultDuration: null,
  defaultPressure: false,
  showTimer: true,
  confirmEnd: true,
  voiceReply: true,
  autoListen: true,
  voiceName: "",
  speechRate: 1,
  recognitionLang: "en-IN",
  captions: true,
  cameraDefault: false,
};

export interface Story {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  tags: string[];
  createdAt: number;
}

export interface Pack {
  id: string;
  title: string;
  company: string;
  role: string;
  roundType: RoundType;
  description: string;
  durationMin: number;
  topics: string[];
  rubric: string[];
  style: string;
  /** "all" = shown for every profile. Otherwise only shown when the profile looks technical. */
  domains: "all" | "technical";
  /** "jd" = generated from a job description. "quick" = assembled by the Quick Mock builder from one or more rounds. Absent for the built-in library. */
  source?: "jd" | "quick";
  createdAt?: number;
}

export interface SessionConfig {
  packId: string;
  persona: Persona;
  durationMin: number;
  pressure: boolean;
  /** Set on Quick Mock sessions: roughly how many main questions the interviewer should ask before wrapping up. */
  questionCount?: number;
}

export interface Message {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  at: number; // ms since session start
}

export interface Session {
  id: string;
  config: SessionConfig;
  messages: Message[];
  code: string;
  startedAt: number;
  endedAt?: number;
  status: "lobby" | "active" | "scoring" | "done";
  reportId?: string;
}

export interface DimensionScore {
  name: string;
  score: number; // 0-10
  evidence: string;
  feedback: string;
}

export interface AnswerReview {
  question: string;
  answerSummary: string;
  score: number; // 0-10
  feedback: string;
  /** A rewrite of the candidate's own answer, personalised to their real facts. */
  betterAnswer: string;
  /** The general model/expected answer for this question — what a strong candidate should cover, not personalised — so they know what was expected going in. */
  expectedAnswer: string;
}

export interface Signals {
  candidateWords: number;
  candidateTurns: number;
  avgWordsPerAnswer: number;
  fillerCount: number;
  fillerRate: number; // per 100 words
  topFillers: { word: string; count: number }[];
}

export interface Report {
  id: string;
  sessionId: string;
  packId: string;
  createdAt: number;
  overall: number; // 0-100
  verdict: "Strong Hire" | "Hire" | "Borderline" | "Not Yet";
  summary: string;
  dimensions: DimensionScore[];
  strengths: string[];
  topFixes: string[];
  answerReviews: AnswerReview[];
  signals: Signals;
}

export interface RoadmapItem {
  id: string;
  week: number;
  title: string;
  detail: string;
  focus: string;
  done: boolean;
}

export interface Roadmap {
  id: string;
  createdAt: number;
  summary: string;
  items: RoadmapItem[];
}

/** A pointer from a note back to the thing it's about, so notes can be attached anywhere in the app. */
export interface NoteLink {
  type: "session" | "pack" | "roadmap-item" | "story" | "other";
  id: string;
  label: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  links: NoteLink[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Cortex: the full notebook. A Binder groups Pages the way a physical ring-binder groups paper —
 * one per subject (e.g. "Behavioural Stories", "System Design", "Company Research").
 */
export interface Binder {
  id: string;
  name: string;
  icon: string; // an emoji
  createdAt: number;
}

export interface CortexPage {
  id: string;
  binderId: string;
  title: string;
  icon: string; // an emoji
  /** Rich text as HTML, produced by the Tiptap editor. */
  contentHtml: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}
