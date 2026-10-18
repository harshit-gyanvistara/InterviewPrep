import type { Message, Signals } from "./types";

const FILLERS = ["um", "uh", "like", "you know", "basically", "actually", "literally", "sort of", "kind of", "i mean", "so yeah"];

export function computeSignals(messages: Message[]): Signals {
  const answers = messages.filter((m) => m.role === "candidate");
  const text = answers.map((m) => m.text.toLowerCase()).join(" \n ");
  const words = text.split(/\s+/).filter(Boolean).length;

  const counts = FILLERS.map((f) => {
    const re = new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "g");
    return { word: f, count: (text.match(re) || []).length };
  })
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);

  const fillerCount = counts.reduce((n, f) => n + f.count, 0);
  return {
    candidateWords: words,
    candidateTurns: answers.length,
    avgWordsPerAnswer: answers.length ? Math.round(words / answers.length) : 0,
    fillerCount,
    fillerRate: words ? Math.round((fillerCount / words) * 1000) / 10 : 0,
    topFillers: counts.slice(0, 4),
  };
}

/** Score status for colour: ok (ready), warn (almost), danger (not yet). One scale for every score UI. */
export type Tone = "ok" | "warn" | "danger";
export const verdictTone = (v: string): Tone => (v === "Strong Hire" || v === "Hire" ? "ok" : v === "Borderline" || v === "Too short" ? "warn" : "danger");
/** False for an interview too short to score: keep it out of averages, bests and charts (plans/honest-scoring.md). */
export const isScored = (r: { verdict: string }) => r.verdict !== "Too short";
/** For a 0–100 score; a 0–10 dimension score is scaled first by the caller (×10). */
export const scoreTone = (score: number): Tone => (score >= 70 ? "ok" : score >= 50 ? "warn" : "danger");
export const verdictColor = (v: string) => ({ ok: "text-ok", warn: "text-warn", danger: "text-danger" })[verdictTone(v)];
