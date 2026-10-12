import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysUntil, recommendPack, sessionsThisWeek, streakDays, weakestDimension } from "./recommend";
import type { Pack, Report, Session } from "./types";

const pack = (id: string, roundType: Pack["roundType"], extra: Partial<Pack> = {}): Pack => ({
  id,
  title: id,
  company: "",
  role: "",
  roundType,
  description: "",
  durationMin: 30,
  topics: ["t"],
  rubric: ["r"],
  style: "",
  domains: "all",
  ...extra,
});

const report = (packId: string, createdAt: number, dims: Record<string, number>): Report => ({
  id: `r-${packId}-${createdAt}`,
  sessionId: "s",
  packId,
  createdAt,
  overall: 50,
  verdict: "Borderline",
  summary: "",
  dimensions: Object.entries(dims).map(([name, score]) => ({ name, score, evidence: "", feedback: "" })),
  strengths: [],
  topFixes: [],
  answerReviews: [],
  signals: { candidateWords: 0, candidateTurns: 0, avgWordsPerAnswer: 0, fillerCount: 0, fillerRate: 0, topFillers: [] },
});

const behavioural = pack("behavioural", "behavioural");
const hr = pack("hr-screen", "hr");
const technical = pack("case-study", "technical");
const coding = pack("live-coding", "coding");
const LIBRARY = [behavioural, hr, technical, coding];

describe("weakestDimension", () => {
  it("returns undefined with no reports", () => {
    expect(weakestDimension([])).toBeUndefined();
  });

  it("averages each dimension across reports and returns the lowest", () => {
    const reports = [report("a", 2, { Clarity: 8, Ownership: 3 }), report("b", 1, { Clarity: 2, Ownership: 5 })];
    // Clarity avg 5, Ownership avg 4
    expect(weakestDimension(reports)).toBe("Ownership");
  });

  it("only looks at the three most recent reports (list is newest first)", () => {
    const reports = [
      report("a", 4, { Clarity: 9, Ownership: 5 }),
      report("b", 3, { Clarity: 9, Ownership: 5 }),
      report("c", 2, { Clarity: 9, Ownership: 5 }),
      report("d", 1, { Clarity: 0, Ownership: 10 }),
    ];
    expect(weakestDimension(reports)).toBe("Ownership");
  });
});

describe("recommendPack", () => {
  it("throws when no packs are available", () => {
    expect(() => recommendPack([], [])).toThrow(/No packs/);
  });

  describe("with no history", () => {
    it("prefers a pack generated from the job description", () => {
      const jd = pack("jd-1", "technical", { source: "jd" });
      const rec = recommendPack([], [...LIBRARY, jd]);
      expect(rec.pack).toBe(jd);
      expect(rec.reason).toMatch(/job description/);
    });

    it("falls back to the baseline behavioural pack", () => {
      const rec = recommendPack([], [hr, behavioural]);
      expect(rec.pack).toBe(behavioural);
      expect(rec.reason).toMatch(/baseline/);
    });

    it("uses the first pack when the baseline is not available", () => {
      expect(recommendPack([], [hr, technical]).pack).toBe(hr);
    });
  });

  describe("with history", () => {
    it.each([
      ["Code quality", coding],
      ["Technical depth", technical],
      ["Clarity", hr],
      ["Ownership", behavioural],
    ])("drills the weakest dimension %s with a matching round type", (weak, expected) => {
      const reports = [report("other", 1, { [weak]: 1, Unmatched: 9 })];
      const rec = recommendPack(reports, LIBRARY);
      expect(rec.pack).toBe(expected);
      expect(rec.reason).toContain(weak);
    });

    it("does not recommend the round the candidate just did", () => {
      const reports = [report("hr-screen", 1, { Clarity: 1 })];
      const otherHr = pack("hr-2", "hr");
      expect(recommendPack(reports, [hr, otherHr]).pack).toBe(otherHr);
    });

    it("falls back to an untried round when the weak dimension matches no rule", () => {
      const reports = [report("behavioural", 1, { Zzz: 1 })];
      const rec = recommendPack(reports, [behavioural, hr]);
      expect(rec.pack).toBe(hr);
      expect(rec.reason).toMatch(/haven't tried/);
    });

    it("falls back to the least recently practised round when every round has been tried", () => {
      const reports = [report("behavioural", 300, { Zzz: 1 }), report("hr-screen", 100, { Zzz: 1 }), report("hr-screen", 200, { Zzz: 1 })];
      const rec = recommendPack(reports, [behavioural, hr]);
      // hr-screen was last done at 200, behavioural at 300
      expect(rec.pack).toBe(hr);
      expect(rec.reason).toMatch(/in a while/);
    });

    it("falls back when the only matching round is the one just done", () => {
      const reports = [report("hr-screen", 1, { Clarity: 1 })];
      expect(recommendPack(reports, [hr, behavioural]).pack).toBe(behavioural);
    });
  });
});

describe("date helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 15, 30)); // 5 Oct 2026, 3:30pm local
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("daysUntil", () => {
    it("returns null for a missing or invalid date", () => {
      expect(daysUntil()).toBeNull();
      expect(daysUntil("")).toBeNull();
      expect(daysUntil("not-a-date")).toBeNull();
    });

    it("counts whole days from today, ignoring the time of day", () => {
      expect(daysUntil("2026-10-05")).toBe(0);
      expect(daysUntil("2026-10-06")).toBe(1);
      expect(daysUntil("2026-10-12")).toBe(7);
      expect(daysUntil("2026-10-01")).toBe(-4);
    });
  });

  describe("sessionsThisWeek", () => {
    const session = (status: Session["status"], daysAgo: number): Session => ({
      id: `${status}-${daysAgo}`,
      config: { packId: "p", persona: "neutral", durationMin: 30, pressure: false } as Session["config"],
      messages: [],
      code: "",
      startedAt: Date.now() - daysAgo * 86400000,
      status,
    });

    it("counts only finished sessions from the last 7 days", () => {
      const sessions = [session("done", 0), session("done", 6.9), session("done", 7.1), session("active", 1), session("scoring", 1)];
      expect(sessionsThisWeek(sessions)).toBe(2);
    });
  });

  describe("streakDays", () => {
    const daysAgo = (n: number, hour = 12) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      d.setHours(hour, 0, 0, 0);
      return d.getTime();
    };

    it("is 0 with no activity", () => {
      expect(streakDays([])).toBe(0);
    });

    it("counts consecutive days ending today", () => {
      expect(streakDays([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3);
    });

    it("keeps yesterday's streak alive if nothing has been done yet today", () => {
      expect(streakDays([daysAgo(1), daysAgo(2)])).toBe(2);
    });

    it("stops at the first gap", () => {
      expect(streakDays([daysAgo(0), daysAgo(1), daysAgo(3), daysAgo(4)])).toBe(2);
    });

    it("is 0 when the last activity was before yesterday", () => {
      expect(streakDays([daysAgo(2), daysAgo(3)])).toBe(0);
    });

    it("counts several sessions on one day once", () => {
      expect(streakDays([daysAgo(0, 9), daysAgo(0, 18), daysAgo(1)])).toBe(2);
    });
  });
});
