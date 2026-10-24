import { describe, expect, it } from "vitest";
import { planStages, planSummary, qualifies, stageComplete, type StageProgress } from "./trajectory";

const stage = (position: number, done: number, over: Partial<StageProgress> = {}): StageProgress => ({ position, done, target: 1, mandatory: true, ...over });

describe("qualifies", () => {
  it("counts every mock when there is no gate", () => {
    expect(qualifies({ overall: 10, verdict: "Not Yet" }, null)).toBe(true);
    expect(qualifies({ overall: 10, verdict: "Too short" }, null)).toBe(true);
  });

  it("needs the score to reach the gate, and never counts a too-short mock", () => {
    expect(qualifies({ overall: 70, verdict: "Hire" }, 70)).toBe(true);
    expect(qualifies({ overall: 69, verdict: "Borderline" }, 70)).toBe(false);
    expect(qualifies({ overall: 95, verdict: "Too short" }, 70)).toBe(false);
  });
});

describe("planStages", () => {
  it("marks the first unfinished stage as current and locks mandatory successors", () => {
    const out = planStages([stage(1, 1), stage(2, 0), stage(3, 0)]);
    expect(out.map((p) => [p.complete, p.locked, p.current])).toEqual([
      [true, false, false],
      [false, false, true],
      [false, true, false],
    ]);
  });

  it("orders by position whatever order it is given", () => {
    expect(planStages([stage(3, 0), stage(1, 0), stage(2, 0)]).map((p) => p.stage.position)).toEqual([1, 2, 3]);
  });

  it("an unfinished optional stage doesn't lock the next one", () => {
    const out = planStages([stage(1, 0, { mandatory: false }), stage(2, 0)]);
    expect(out.map((p) => [p.locked, p.current])).toEqual([[false, true], [false, false]]);
    // The mandatory one after it is open too, but only one stage is "current".
  });

  it("a finished stage is never locked, even if an earlier mandatory one is open", () => {
    const out = planStages([stage(1, 0), stage(2, 1)]);
    expect(out.map((p) => [p.complete, p.locked])).toEqual([[false, false], [true, false]]);
  });

  it("needs the whole target, not just one mock", () => {
    expect(stageComplete({ done: 2, target: 3 })).toBe(false);
    expect(stageComplete({ done: 3, target: 3 })).toBe(true);
  });

  it("summarises progress and handles an empty plan", () => {
    expect(planSummary(planStages([stage(1, 1), stage(2, 0)]))).toEqual({ done: 1, total: 2 });
    expect(planStages([])).toEqual([]);
  });
});
