import { describe, expect, it } from "vitest";
import { noteFromSuggestion, pendingSuggestions, suggestNotes } from "./noteSuggestions";
import type { AnswerReview, Report } from "./types";

const answer = (question: string, score: number, extra: Partial<AnswerReview> = {}): AnswerReview => ({
  question,
  answerSummary: `About ${question}`,
  score,
  feedback: "",
  betterAnswer: `Better ${question}`,
  expectedAnswer: `Expected ${question}`,
  ...extra,
});

const report = (extra: Partial<Report> = {}): Report => ({
  id: "r1",
  sessionId: "s1",
  packId: "behavioural",
  createdAt: 1,
  overall: 55,
  verdict: "Borderline",
  summary: "",
  dimensions: [
    { name: "Structure", score: 4, evidence: "I just did it", feedback: "Use STAR." },
    { name: "Communication", score: 7, evidence: "", feedback: "Clear." },
  ],
  strengths: [],
  topFixes: ["Quantify your impact", "Lead with the result", "Shorter answers"],
  answerReviews: [answer("Tell me about yourself", 6), answer("A conflict", 3), answer("A failure", 9), answer("Why us", 2)],
  signals: { candidateWords: 400, candidateTurns: 4, avgWordsPerAnswer: 100, fillerCount: 24, fillerRate: 6, topFillers: [{ word: "um", count: 14 }, { word: "like", count: 10 }] },
  ...extra,
});

describe("suggestNotes", () => {
  it("offers fixes, the weakest answers, the weakest skill, fillers and the best story, most useful first", () => {
    expect(suggestNotes(report()).map((s) => s.key)).toEqual(["fix:0", "fix:1", "rehearse:3", "rehearse:1", "skill:Structure", "fillers", "story:2"]);
  });

  it("puts the stronger and expected answers in a rehearse note", () => {
    const s = suggestNotes(report()).find((x) => x.key === "rehearse:1")!;
    expect(s.title).toBe("Rehearse: A conflict");
    expect(s.body).not.toContain("Q:"); // the whole question is in the title
    expect(s.body).toContain("A stronger version: Better A conflict");
    expect(s.body).toContain("What the interviewer expected: Expected A conflict");
  });

  it("skips what isn't there: no weak answers, skills not assessed, few fillers, no strong answer", () => {
    const r = report({
      topFixes: [],
      dimensions: [{ name: "Coding", score: 0, evidence: "", feedback: "No evidence.", assessed: false }],
      answerReviews: [answer("Q", 7)],
      signals: { candidateWords: 50, candidateTurns: 1, avgWordsPerAnswer: 50, fillerCount: 3, fillerRate: 6, topFillers: [] },
    });
    expect(suggestNotes(r)).toEqual([]);
  });

  it("clips long titles at a word and keeps the full text in the body", () => {
    const fix = "Open every behavioural answer with the outcome and a number, then walk back through the situation";
    const [s] = suggestNotes(report({ topFixes: [fix] }));
    expect(s.title.length).toBeLessThanOrEqual(76);
    expect(s.title.endsWith("…")).toBe(true);
    expect(s.body).toBe(fix);
    expect(suggestNotes(report({ topFixes: ["Lead with the result"] }))[0]).toMatchObject({ title: "Fix: Lead with the result", body: "" });
  });

  it("keys stay the same for the same report", () => {
    expect(suggestNotes(report())).toEqual(suggestNotes(report()));
  });
});

describe("pendingSuggestions", () => {
  it("leaves out accepted and discarded ones", () => {
    const keys = pendingSuggestions(report({ noteSuggestions: { "fix:0": "accepted", fillers: "discarded" } })).map((s) => s.key);
    expect(keys).not.toContain("fix:0");
    expect(keys).not.toContain("fillers");
    expect(keys).toContain("fix:1");
  });
});

describe("noteFromSuggestion", () => {
  it("links the note to the interview and its round", () => {
    const [s] = suggestNotes(report());
    const note = noteFromSuggestion(s, report(), "Behavioural Interview", "n1", 100);
    expect(note).toMatchObject({ id: "n1", title: s.title, body: s.body, tags: ["fix"], pinned: false, createdAt: 100, updatedAt: 100 });
    expect(note.links).toEqual([
      { type: "session", id: "s1", label: "Behavioural Interview" },
      { type: "pack", id: "behavioural", label: "Behavioural Interview" },
    ]);
  });
});
