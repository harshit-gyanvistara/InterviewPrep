import { descendantIds, treeOrder } from "./orgSections";
import { shareAllows, type ShareLevel } from "./permissions";

// Client-safe, pure. What an org's admins see about their members (plans/m2-org.md O.6), always
// cut down to each member's share level (D11): "activity" shows mocks taken and when; "scores"
// adds scores, verdicts and weak skills; "full" also opens transcripts (loaded separately).
// Only practice done for the org (reports stamped with its org_id) ever reaches these functions.

export interface OrgMember {
  userId: string;
  email: string | null;
  role: string;
  cohortId: string | null;
  joinedAt: string;
  shareLevel: ShareLevel;
}

/** One org-stamped report, reduced to what analytics needs. */
export interface OrgReport {
  userId: string;
  sessionId: string;
  createdAt: number;
  packId: string;
  overall: number;
  verdict: string;
  dimensions: { name: string; score: number; assessed?: boolean }[];
  fillerRate: number | null;
}

/** A report as a viewer may see it, given the member's share level. */
export type VisibleReport = Pick<OrgReport, "sessionId" | "createdAt" | "packId"> & Partial<Pick<OrgReport, "overall" | "verdict" | "dimensions">>;

export interface MemberRow {
  userId: string;
  email: string | null;
  role: string;
  cohortId: string | null;
  shareLevel: ShareLevel;
  mocks: number;
  lastPracticeAt: number | null;
  /** Average of the last 3 scored mocks; null when not shared or none scored. */
  readiness: number | null;
}

export interface CohortStats {
  cohortId: string | null;
  name: string;
  members: number;
  activeLast7Days: number;
  mocks: number;
  /** Members sharing scores, who the score figures below are based on. */
  sharingScores: number;
  /** Score figures need at least MIN_GROUP sharing members, so nobody's scores can be singled out. */
  scores: { readiness: number; averageOverall: number; weakestSkills: string[]; fillerRate: number | null } | null;
}

/** Below this many members sharing scores, a group shows counts only. */
export const MIN_GROUP = 3;
const WEEK_MS = 7 * 86_400_000;

const scored = (r: OrgReport) => r.verdict !== "Too short";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null) => (x === null ? null : Math.round(x));

export function visibleReport(r: OrgReport, level: ShareLevel): VisibleReport {
  const base = { sessionId: r.sessionId, createdAt: r.createdAt, packId: r.packId };
  return shareAllows(level, "scores") ? { ...base, overall: r.overall, verdict: r.verdict, dimensions: r.dimensions } : base;
}

/** Average of the latest 3 scored mocks (reports newest first). */
export function readiness(reports: OrgReport[]): number | null {
  return round(mean([...reports].sort((a, b) => b.createdAt - a.createdAt).filter(scored).slice(0, 3).map((r) => r.overall)));
}

export function memberRow(m: OrgMember, reports: OrgReport[]): MemberRow {
  const mine = reports.filter((r) => r.userId === m.userId);
  return {
    userId: m.userId,
    email: m.email,
    role: m.role,
    cohortId: m.cohortId,
    shareLevel: m.shareLevel,
    mocks: mine.length,
    lastPracticeAt: mine.length ? Math.max(...mine.map((r) => r.createdAt)) : null,
    readiness: shareAllows(m.shareLevel, "scores") ? readiness(mine) : null,
  };
}

/** The lowest-scoring skills across these reports, assessed ones only. */
export function weakestSkills(reports: OrgReport[], n = 3): string[] {
  const by = new Map<string, number[]>();
  for (const r of reports.filter(scored)) for (const d of r.dimensions) if (d.assessed !== false) by.set(d.name, [...(by.get(d.name) ?? []), d.score]);
  return [...by.entries()]
    .map(([name, v]) => ({ name, avg: mean(v)! }))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, n)
    .map((x) => x.name);
}

export function groupStats(cohortId: string | null, name: string, members: OrgMember[], reports: OrgReport[], now = Date.now()): CohortStats {
  const ids = new Set(members.map((m) => m.userId));
  const theirs = reports.filter((r) => ids.has(r.userId));
  const sharing = members.filter((m) => shareAllows(m.shareLevel, "scores"));
  const sharingIds = new Set(sharing.map((m) => m.userId));
  const shared = theirs.filter((r) => sharingIds.has(r.userId));
  const perMember = sharing.map((m) => readiness(shared.filter((r) => r.userId === m.userId))).filter((x): x is number => x !== null);
  const fillers = shared.map((r) => r.fillerRate).filter((x): x is number => x !== null);
  return {
    cohortId,
    name,
    members: members.length,
    activeLast7Days: new Set(theirs.filter((r) => now - r.createdAt < WEEK_MS).map((r) => r.userId)).size,
    mocks: theirs.length,
    sharingScores: sharing.length,
    scores:
      sharing.length >= MIN_GROUP && perMember.length
        ? {
            readiness: round(mean(perMember))!,
            averageOverall: round(mean(shared.filter(scored).map((r) => r.overall))) ?? 0,
            weakestSkills: weakestSkills(shared),
            fillerRate: fillers.length ? Math.round(mean(fillers)! * 10) / 10 : null,
          }
        : null,
  };
}

/**
 * Stats for the whole org, then each cohort in tree order (a cohort counts everyone in it and in
 * the sections below it), then members in no cohort (when there are any).
 */
export function analytics(members: OrgMember[], reports: OrgReport[], cohorts: { id: string; name: string; parentId?: string | null }[], now = Date.now()): CohortStats[] {
  const out = [groupStats(null, "Everyone", members, reports, now)];
  const nodes = cohorts.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId ?? null }));
  for (const c of treeOrder(nodes)) {
    const within = new Set(descendantIds(nodes, c.id));
    out.push(groupStats(c.id, c.name, members.filter((m) => m.cohortId !== null && within.has(m.cohortId)), reports, now));
  }
  const none = members.filter((m) => !m.cohortId);
  if (cohorts.length && none.length) out.push(groupStats(null, "No cohort", none, reports, now));
  return out;
}

/** Members who haven't practised for the org in the last 7 days (or ever). */
export const inactive = (rows: MemberRow[], now = Date.now()) => rows.filter((r) => !r.lastPracticeAt || now - r.lastPracticeAt >= WEEK_MS);

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas (a leading = + - @).
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** One line per member, at each member's share level (scores blank unless shared). */
export function membersCsv(rows: MemberRow[], cohortName: (id: string | null) => string): string {
  const head = ["email", "role", "cohort", "sharing", "mocks", "last practice", "readiness"];
  const lines = rows.map((r) => [r.email, r.role, cohortName(r.cohortId), r.shareLevel, r.mocks, r.lastPracticeAt ? new Date(r.lastPracticeAt).toISOString().slice(0, 10) : "", r.readiness ?? ""]);
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}
