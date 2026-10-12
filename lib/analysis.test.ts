import { describe, expect, it } from "vitest";
import { computeSignals, verdictColor } from "./analysis";
import type { Message } from "./types";

let n = 0;
const msg = (role: Message["role"], text: string): Message => ({ id: String(n++), role, text, at: n * 1000 });
const candidate = (text: string) => msg("candidate", text);
const interviewer = (text: string) => msg("interviewer", text);

describe("computeSignals", () => {
  it("returns zeros for an empty transcript", () => {
    expect(computeSignals([])).toEqual({
      candidateWords: 0,
      candidateTurns: 0,
      avgWordsPerAnswer: 0,
      fillerCount: 0,
      fillerRate: 0,
      topFillers: [],
    });
  });

  it("ignores interviewer messages", () => {
    const s = computeSignals([interviewer("um so like tell me about yourself"), candidate("I build things")]);
    expect(s.candidateTurns).toBe(1);
    expect(s.candidateWords).toBe(3);
    expect(s.fillerCount).toBe(0);
  });

  it("counts words and averages them per answer, rounded", () => {
    const s = computeSignals([candidate("one two three"), candidate("four five six seven eight")]);
    expect(s.candidateWords).toBe(8);
    expect(s.candidateTurns).toBe(2);
    expect(s.avgWordsPerAnswer).toBe(4);
  });

  it("counts fillers case-insensitively and only on word boundaries", () => {
    const s = computeSignals([candidate("Um, I would LIKE to say it is likely, um, fine. Actually, unlike before.")]);
    // "like" (LIKE) counts; "likely" and "unlike" do not
    expect(s.topFillers).toEqual([
      { word: "um", count: 2 },
      { word: "like", count: 1 },
      { word: "actually", count: 1 },
    ]);
    expect(s.fillerCount).toBe(4);
  });

  it("matches multi-word fillers across any whitespace", () => {
    const s = computeSignals([candidate("you   know, it was\tsort of hard, you\nknow")]);
    expect(s.topFillers).toEqual([
      { word: "you know", count: 2 },
      { word: "sort of", count: 1 },
    ]);
  });

  it("reports filler rate per 100 words to one decimal place", () => {
    // 3 fillers in 7 words = 42.857… per 100
    const s = computeSignals([candidate("um uh basically I did the work")]);
    expect(s.candidateWords).toBe(7);
    expect(s.fillerRate).toBe(42.9);
  });

  it("keeps the top four fillers, most frequent first", () => {
    const s = computeSignals([candidate("um um um uh uh like like basically actually literally")]);
    expect(s.topFillers.map((f) => f.word)).toEqual(["um", "uh", "like", "basically"]);
    expect(s.fillerCount).toBe(10);
  });
});

describe("verdictColor", () => {
  it.each([
    ["Strong Hire", "text-emerald-600"],
    ["Hire", "text-green-600"],
    ["Borderline", "text-amber-600"],
    ["Not Yet", "text-rose-600"],
  ])("%s → %s", (verdict, cls) => {
    expect(verdictColor(verdict)).toBe(cls);
  });
});
