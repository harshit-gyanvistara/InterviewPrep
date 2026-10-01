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

export const verdictColor = (v: string) =>
  v === "Strong Hire" ? "text-emerald-600" : v === "Hire" ? "text-green-600" : v === "Borderline" ? "text-amber-600" : "text-rose-600";
