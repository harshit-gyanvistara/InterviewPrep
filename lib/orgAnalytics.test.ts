import { describe, expect, it } from "vitest";
import { analytics, groupStats, inactive, memberRow, membersCsv, readiness, visibleReport, weakestSkills, type OrgMember, type OrgReport } from "./orgAnalytics";

// What org admins see (plans/m2-org.md O.6), always at each member's share level.

const NOW = Date.parse("2026-10-19T12:00:00Z");
const DAY = 86_400_000;
const member = (userId: string, shareLevel: OrgMember["shareLevel"], cohortId: string | null = null): OrgMember => ({ userId, email: `${userId}@college.edu`, role: "member", cohortId, joinedAt: "t", shareLevel });
let n = 0;
const report = (userId: string, overall: number, daysAgo = 1, over: Partial<OrgReport> = {}): OrgReport => ({
  userId,
  sessionId: `s${++n}`,
  createdAt: NOW - daysAgo * DAY,
  packId: "behavioural",
  overall,
  verdict: overall >= 70 ? "Hire" : "Borderline",
  dimensions: [
    { name: "Structure", score: overall / 10 - 1 },
    { name: "Clarity", score: overall / 10 },
  ],
  fillerRate: 2,
  ...over,
});

describe("share levels", () => {
  it("activity shows only what and when; scores adds results", () => {
    const r = report("a", 72);
    expect(visibleReport(r, "activity")).toEqual({ sessionId: r.sessionId, createdAt: r.createdAt, packId: "behavioural" });
    expect(visibleReport(r, "scores")).toMatchObject({ overall: 72, verdict: "Hire", dimensions: r.dimensions });
    expect(visibleReport(r, "full")).toMatchObject({ overall: 72 });
  });

  it("member rows hide readiness unless scores are shared", () => {
    const reps = [report("a", 60), report("a", 80)];
    expect(memberRow(member("a", "activity"), reps)).toMatchObject({ mocks: 2, readiness: null });
    expect(memberRow(member("a", "scores"), reps)).toMatchObject({ mocks: 2, readiness: 70 });
  });
});

describe("readiness and skills", () => {
  it("averages the latest 3 scored mocks, skipping too-short ones", () => {
    const reps = [report("a", 40, 9), report("a", 60, 3), report("a", 70, 2), report("a", 80, 1), report("a", 10, 0, { verdict: "Too short" })];
    expect(readiness(reps)).toBe(70);
  });

  it("weakest skills ignore unassessed ones and too-short mocks", () => {
    const r1 = report("a", 70, 1, { dimensions: [{ name: "Structure", score: 4 }, { name: "Ownership", score: 0, assessed: false }, { name: "Clarity", score: 8 }] });
    const r2 = report("a", 10, 1, { verdict: "Too short", dimensions: [{ name: "Clarity", score: 0 }] });
    expect(weakestSkills([r1, r2], 2)).toEqual(["Structure", "Clarity"]);
  });
});

describe("group stats", () => {
  it("shows scores only with at least 3 members sharing them", () => {
    const two = [member("a", "scores"), member("b", "full"), member("c", "activity")];
    const reps = [report("a", 60), report("b", 80), report("c", 90)];
    const g = groupStats(null, "Everyone", two, reps, NOW);
    expect(g).toMatchObject({ members: 3, mocks: 3, sharingScores: 2, scores: null });

    const three = [...two.slice(0, 2), member("c", "scores")];
    const g3 = groupStats(null, "Everyone", three, reps, NOW);
    expect(g3.scores).toMatchObject({ readiness: 77, averageOverall: 77, fillerRate: 2 });
  });

  it("counts members active in the last 7 days", () => {
    const g = groupStats(null, "x", [member("a", "scores"), member("b", "scores")], [report("a", 70, 2), report("b", 70, 10)], NOW);
    expect(g.activeLast7Days).toBe(1);
  });

  it("splits by cohort, and lists members in no cohort", () => {
    const ms = [member("a", "scores", "c1"), member("b", "scores", "c1"), member("c", "scores")];
    const out = analytics(ms, [report("a", 70)], [{ id: "c1", name: "CSE" }], NOW);
    expect(out.map((g) => [g.name, g.members, g.mocks])).toEqual([
      ["Everyone", 3, 1],
      ["CSE", 2, 1],
      ["No cohort", 1, 0],
    ]);
  });

  it("finds members who've gone quiet", () => {
    const rows = [memberRow(member("a", "scores"), [report("a", 70, 2)]), memberRow(member("b", "scores"), [report("b", 70, 8)]), memberRow(member("c", "scores"), [])];
    expect(inactive(rows, NOW).map((r) => r.userId)).toEqual(["b", "c"]);
  });
});

describe("CSV export", () => {
  it("leaves scores blank unless shared, and defuses spreadsheet formulas", () => {
    const rows = [memberRow({ ...member("a", "activity"), email: "=HYPERLINK(1)" }, [report("a", 90)]), memberRow(member("b", "scores", "c1"), [report("b", 64)])];
    const csv = membersCsv(rows, (id) => (id === "c1" ? "CSE" : ""));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe('"email","role","cohort","sharing","mocks","last practice","readiness"');
    expect(lines[1]).toBe(`"'=HYPERLINK(1)","member","","activity","1","2026-10-18",""`);
    expect(lines[2]).toBe('"b@college.edu","member","CSE","scores","1","2026-10-18","64"');
  });
});
