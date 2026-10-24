// Client-safe, pure. Trajectories: an ordered plan of stages, each a round to practise a number of
// times, optionally with a score to reach (plans/b2b-college.md B.6). Each stage becomes an
// assignment when the plan is given to a section or group, copying the gate, so editing the plan
// later never changes work already set or rewrites anyone's progress.

export const MAX_STAGES = 12;

/** What a stage needs to know about a report: its score and whether it was too short to count as one. */
export interface ReportLite {
  overall: number;
  verdict: string;
}

/**
 * Does this report count toward a stage? Without a gate every mock counts (as plain assignments always
 * have). With one, the score must reach it, and a "Too short" mock never counts however it scored.
 */
export function qualifies(report: ReportLite, gate: number | null): boolean {
  if (gate === null) return true;
  return report.verdict !== "Too short" && report.overall >= gate;
}

export interface StageProgress {
  /** Qualifying mocks done so far. */
  done: number;
  target: number;
  mandatory: boolean;
  position: number;
}

export const stageComplete = (s: Pick<StageProgress, "done" | "target">) => s.done >= s.target;

export interface PlannedStage<T extends StageProgress = StageProgress> {
  stage: T;
  complete: boolean;
  /** An earlier mandatory stage isn't finished yet: shown, but marked "finish X first". */
  locked: boolean;
  /** The stage to work on now: the first unfinished one that isn't locked. */
  current: boolean;
}

/** Stages in order with their state. Optional stages never lock the ones after them. */
export function planStages<T extends StageProgress>(stages: T[]): PlannedStage<T>[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  let blocked = false;
  let currentTaken = false;
  return ordered.map((stage) => {
    const complete = stageComplete(stage);
    const locked = blocked && !complete;
    const current = !complete && !locked && !currentTaken;
    if (current) currentTaken = true;
    if (!complete && stage.mandatory) blocked = true;
    return { stage, complete, locked, current };
  });
}

/** "Interview readiness · 2 of 4 stages done". */
export const planSummary = (planned: PlannedStage[]) => ({ done: planned.filter((p) => p.complete).length, total: planned.length });
