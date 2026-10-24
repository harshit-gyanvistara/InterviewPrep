import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { listAssignments } from "./orgCohorts";
import type { OrgRef } from "./orgInvites";
import { assignTrajectory, createTrajectory, deleteRun, listTrajectories, myPlans, updateTrajectory } from "./orgTrajectories";
import { PACKS } from "./packs";
import { TrajectoryAssignBodySchema, TrajectoryBodySchema } from "./schemas";

// Trajectories: plans of stages given to a section or group (plans/b2b-college.md B.6).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./catalog-server", async () => ({ getCatalog: async () => ({ packs: (await import("./packs")).PACKS, domains: [] }) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const PLAN = "22222222-2222-2222-2222-222222222222";
const DEPT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SECTION = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const OTHER = "99999999-9999-9999-9999-999999999999";
const GROUP = "12121212-1212-1212-1212-121212121212";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string, cohortId: string | null = null): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role, cohortId });
const [P1, P2] = [PACKS[0].id, PACKS[1].id];

const stage = (over: Record<string, unknown> = {}) => ({ title: "Warm-up", packId: P1, targetCount: 1, dueDays: null, gateScore: null, mandatory: true, ...over });
const body = (stages = [stage()]) => ({ name: "Campus placement", description: "", stages });
const tree = [
  { id: DEPT, org_id: ORG, name: "CSE", parent_id: null, archived: false },
  { id: SECTION, org_id: ORG, name: "A", parent_id: DEPT, archived: false },
  { id: OTHER, org_id: ORG, name: "ECE", parent_id: null, archived: false },
];

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  let next = 0;
  const db = {
    from(table: string) {
      let op = "select";
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        delete: () => ((op = "delete"), writes.push({ table, op }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        order: () => q,
        single: async () => ({ data: { id: `new-${++next}` }, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: op === "insert" ? null : rows(), error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("body schemas", () => {
  it("defaults a stage to one mock, any score, mandatory, no due date", () => {
    expect(TrajectoryBodySchema.parse({ name: "P", stages: [{ title: "S", packId: "x" }] }).stages[0]).toEqual({ title: "S", packId: "x", targetCount: 1, dueDays: null, gateScore: null, mandatory: true });
  });

  it("rejects blank names, no stages, too many, and out-of-range gates", () => {
    const ok = { name: "P", stages: [{ title: "S", packId: "x" }] };
    for (const bad of [{ name: " " }, { stages: [] }, { stages: Array.from({ length: 13 }, () => ({ title: "S", packId: "x" })) }, { stages: [{ title: "S", packId: "x", gateScore: 101 }] }, { stages: [{ title: "", packId: "x" }] }]) {
      expect(TrajectoryBodySchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });

  it("an assignment goes to a cohort or a group, not both", () => {
    expect(TrajectoryAssignBodySchema.safeParse({ cohortId: DEPT, groupId: GROUP }).success).toBe(false);
    expect(TrajectoryAssignBodySchema.parse({})).toEqual({ cohortId: null, groupId: null });
  });
});

describe("building plans", () => {
  it("saves the plan and numbers its stages from 1", async () => {
    const { db, writes } = fakeDb({});
    await createTrajectory(db, me, org("admin"), body([stage({ title: "A" }), stage({ title: "B", packId: P2, gateScore: 70 })]));
    expect(writes.map((w) => w.table)).toEqual(["trajectories", "trajectory_stages", "audit_logs"]);
    expect((writes[1].payload as { position: number; gate_score: number | null }[]).map((r) => [r.position, r.gate_score])).toEqual([[1, null], [2, 70]]);
  });

  it("refuses unknown rounds, and plain members", async () => {
    await expect(createTrajectory(fakeDb({}).db, me, org("admin"), body([stage({ packId: "made-up" })]))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Stage 1") });
    await expect(createTrajectory(fakeDb({}).db, me, org("member"), body())).rejects.toMatchObject({ status: 403 });
  });

  it("allows one of the org's own rounds", async () => {
    const { db } = fakeDb({ org_packs: [{ id: "org-1", org_id: ORG, archived: false }] });
    await expect(createTrajectory(db, me, org("admin"), body([stage({ packId: "org-1" })]))).resolves.toBeDefined();
  });

  it("replaces the stages on edit and 404s a plan from another org", async () => {
    const { db, writes } = fakeDb({ trajectories: [{ id: PLAN, org_id: ORG }] });
    await updateTrajectory(db, me, org("admin"), PLAN, { name: "Renamed", stages: [stage({ title: "Only" })] });
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["trajectories.update", "trajectory_stages.delete", "trajectory_stages.insert", "audit_logs.insert"]);
    await expect(updateTrajectory(fakeDb({ trajectories: [] }).db, me, org("admin"), PLAN, { archived: true })).rejects.toMatchObject({ status: 404 });
  });

  it("lists plans with their stages in order and their runs", async () => {
    const { db } = fakeDb({
      trajectories: [{ id: PLAN, org_id: ORG, name: "P", description: "", archived: false }],
      trajectory_stages: [
        { id: "s1", trajectory_id: PLAN, position: 1, title: "A", pack_id: P1, target_count: 1, due_days: 7, gate_score: 60, mandatory: true },
      ],
      trajectory_runs: [{ id: "r1", org_id: ORG, trajectory_id: PLAN, name: "P", cohort_id: DEPT, group_id: null, starts_at: "2026-11-01T00:00:00Z" }],
    });
    const [p] = await listTrajectories(db, org("coach"));
    expect(p.stages[0]).toMatchObject({ title: "A", dueDays: 7, gateScore: 60 });
    expect(p.runs).toEqual([{ id: "r1", name: "P", cohortId: DEPT, groupId: null, startsAt: "2026-11-01T00:00:00Z" }]);
  });
});

describe("giving a plan out", () => {
  const tables = () => ({
    cohorts: tree,
    trajectories: [{ id: PLAN, org_id: ORG, name: "Campus placement", archived: false }],
    trajectory_stages: [
      { trajectory_id: PLAN, position: 1, title: "Behavioural", pack_id: P1, target_count: 1, due_days: 7, gate_score: 60, mandatory: true },
      { trajectory_id: PLAN, position: 2, title: "Technical", pack_id: P2, target_count: 2, due_days: null, gate_score: null, mandatory: false },
    ],
  });

  it("copies each stage into an assignment with its order, gate and due date counted from the start", async () => {
    const { db, writes } = fakeDb(tables());
    const out = await assignTrajectory(db, me, org("admin"), PLAN, { cohortId: DEPT, groupId: null, startsAt: "2026-11-01T00:00:00.000Z" });
    expect(out.stages).toBe(2);
    const run = writes.find((w) => w.table === "trajectory_runs")!.payload;
    expect(run).toMatchObject({ org_id: ORG, trajectory_id: PLAN, name: "Campus placement", cohort_id: DEPT });
    const rows = writes.find((w) => w.table === "assignments")!.payload as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ title: "Campus placement · Behavioural", position: 1, gate_score: 60, mandatory: true, cohort_id: DEPT, due_at: "2026-11-08T00:00:00.000Z", target_mock_count: 1 });
    expect(rows[1]).toMatchObject({ position: 2, mandatory: false, due_at: null, target_mock_count: 2 });
    expect(rows.every((r) => r.run_id === out.runId)).toBe(true);
  });

  it("keeps a coach to their own section, and groups to people who manage cohorts", async () => {
    await expect(assignTrajectory(fakeDb(tables()).db, me, org("coach", DEPT), PLAN, { cohortId: SECTION, groupId: null })).resolves.toBeDefined();
    await expect(assignTrajectory(fakeDb(tables()).db, me, org("coach", DEPT), PLAN, { cohortId: OTHER, groupId: null })).rejects.toMatchObject({ status: 403 });
    await expect(assignTrajectory(fakeDb(tables()).db, me, org("coach", DEPT), PLAN, { cohortId: null, groupId: GROUP })).rejects.toMatchObject({ status: 403 });
    await expect(assignTrajectory(fakeDb({ ...tables(), groups: [{ id: GROUP, org_id: ORG, archived: false }] }).db, me, org("admin"), PLAN, { cohortId: null, groupId: GROUP })).resolves.toBeDefined();
  });

  it("refuses an archived or missing plan, a stage whose round has gone, and members", async () => {
    await expect(assignTrajectory(fakeDb({ ...tables(), trajectories: [{ id: PLAN, org_id: ORG, name: "P", archived: true }] }).db, me, org("admin"), PLAN, { cohortId: null, groupId: null })).rejects.toMatchObject({ status: 404 });
    const gone = { ...tables(), trajectory_stages: [{ trajectory_id: PLAN, position: 1, title: "Old", pack_id: "org-gone", target_count: 1, due_days: null, gate_score: null, mandatory: true }] };
    await expect(assignTrajectory(fakeDb(gone).db, me, org("admin"), PLAN, { cohortId: null, groupId: null })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Old") });
    await expect(assignTrajectory(fakeDb(tables()).db, me, org("member"), PLAN, { cohortId: null, groupId: null })).rejects.toMatchObject({ status: 403 });
  });

  it("takes a run back, and 404s an unknown one", async () => {
    await expect(deleteRun(fakeDb({ trajectory_runs: [{ id: "r1", org_id: ORG, name: "P" }] }).db, me, org("admin"), "r1")).resolves.toBeUndefined();
    await expect(deleteRun(fakeDb({ trajectory_runs: [] }).db, me, org("admin"), "r1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("gates decide what counts", () => {
  it("counts only mocks that reach the gate, never a too-short one, for staff progress", async () => {
    const { db } = fakeDb({
      cohorts: [],
      assignments: [
        { id: "gated", org_id: ORG, title: "G", pack_id: P1, cohort_id: null, group_id: null, due_at: null, target_mock_count: 1, created_at: "t", gate_score: 70 },
        { id: "plain", org_id: ORG, title: "P", pack_id: P1, cohort_id: null, group_id: null, due_at: null, target_mock_count: 1, created_at: "t", gate_score: null },
      ],
      memberships: [{ org_id: ORG, status: "active", user_id: "u1", cohort_id: null, role: "member" }, { org_id: ORG, status: "active", user_id: "u2", cohort_id: null, role: "member" }, { org_id: ORG, status: "active", user_id: "u3", cohort_id: null, role: "member" }],
      reports: [
        { assignment_id: "gated", user_id: "u1", data: { overall: 82, verdict: "Hire" } },
        { assignment_id: "gated", user_id: "u2", data: { overall: 55, verdict: "Not Yet" } },
        { assignment_id: "gated", user_id: "u3", data: { overall: 95, verdict: "Too short" } },
        { assignment_id: "plain", user_id: "u2", data: { overall: 10, verdict: "Not Yet" } },
        { assignment_id: "plain", user_id: "u3", data: { overall: 90, verdict: "Too short" } },
      ],
    });
    const out = await listAssignments(db, org("admin"));
    expect(out.map((a) => [a.title, a.completedBy])).toEqual([["G", 1], ["P", 2]]);
  });

  it("counts a waived member as complete", async () => {
    const { db } = fakeDb({
      cohorts: [],
      assignments: [{ id: "g", org_id: ORG, title: "G", pack_id: P1, cohort_id: null, group_id: null, due_at: null, target_mock_count: 1, created_at: "t", gate_score: 70 }],
      memberships: [{ org_id: ORG, status: "active", user_id: "u1", cohort_id: null, role: "member" }, { org_id: ORG, status: "active", user_id: "u2", cohort_id: null, role: "member" }],
      assignment_waivers: [{ assignment_id: "g", user_id: "u2", reason: "Excused" }],
    });
    expect((await listAssignments(db, org("admin")))[0]).toMatchObject({ assignedTo: 2, completedBy: 1 });
  });
});

describe("a member's plan", () => {
  const run = (over: Record<string, unknown> = {}) => ({ org_id: ORG, cohort_id: null, group_id: null, run_id: "r1", mandatory: true, due_at: null, ...over });
  const base = (reports: Record<string, unknown>[], extra: Record<string, unknown[]> = {}) => ({
    memberships: [{ user_id: "me", status: "active", role: "member", org_id: ORG, cohort_id: SECTION, organizations: { name: "Sunrise" } }],
    cohorts: tree,
    trajectory_runs: [{ id: "r1", name: "Campus placement" }],
    assignments: [
      run({ id: "a1", title: "Campus placement · Behavioural", pack_id: P1, position: 1, target_mock_count: 1, gate_score: 70, cohort_id: DEPT }),
      run({ id: "a2", title: "Campus placement · Technical", pack_id: P2, position: 2, target_mock_count: 1, gate_score: null, cohort_id: DEPT }),
      run({ id: "x1", run_id: "r2", title: "ECE only", pack_id: P1, position: 1, target_mock_count: 1, gate_score: null, cohort_id: OTHER }),
    ],
    reports,
    ...extra,
  });

  it("shows stages in order, the next one open and later mandatory ones locked", async () => {
    const [plan] = await myPlans(fakeDb(base([{ assignment_id: "a1", user_id: "me", data: { overall: 50, verdict: "Not Yet" } }])).db, me);
    expect(plan).toMatchObject({ runId: "r1", name: "Campus placement", orgName: "Sunrise" });
    expect(plan.stages.map((s) => [s.title.split(" · ")[1], s.done, s.complete, s.locked, s.current])).toEqual([
      ["Behavioural", 0, false, false, true], // 50 is below the gate of 70, so it doesn't count
      ["Technical", 0, false, true, false],
    ]);
  });

  it("completing a gated stage unlocks the next", async () => {
    const [plan] = await myPlans(fakeDb(base([{ assignment_id: "a1", user_id: "me", data: { overall: 74, verdict: "Hire" } }])).db, me);
    expect(plan.stages.map((s) => [s.complete, s.locked, s.current])).toEqual([[true, false, false], [false, false, true]]);
  });

  it("reports attempts and best score even when none count, ignoring too-short mocks for the best", async () => {
    const [plan] = await myPlans(fakeDb(base([
      { assignment_id: "a1", user_id: "me", data: { overall: 50, verdict: "Not Yet" } },
      { assignment_id: "a1", user_id: "me", data: { overall: 62, verdict: "Borderline" } },
      { assignment_id: "a1", user_id: "me", data: { overall: 99, verdict: "Too short" } },
    ])).db, me);
    expect(plan.stages[0]).toMatchObject({ done: 0, attempts: 3, bestScore: 62, complete: false });
  });

  it("a waived stage counts as done, unlocks the next, and says why", async () => {
    const [plan] = await myPlans(fakeDb(base([], { assignment_waivers: [{ assignment_id: "a1", user_id: "me", reason: "Medical leave" }] })).db, me);
    expect(plan.stages[0]).toMatchObject({ complete: true, waived: true, waivedReason: "Medical leave", done: 1 });
    expect(plan.stages[1]).toMatchObject({ locked: false, current: true });
  });

  it("only includes plans that apply to my section, and none for staff", async () => {
    const plans = await myPlans(fakeDb(base([])).db, me);
    expect(plans.map((p) => p.runId)).toEqual(["r1"]); // the ECE-only run is not mine
    const staff = base([]);
    staff.memberships[0].role = "coach";
    expect(await myPlans(fakeDb(staff).db, me)).toEqual([]);
  });

  it("includes a group plan only for its members", async () => {
    const group = (inGroup: boolean) => base([], { assignments: [run({ id: "g1", run_id: "r1", title: "Drive · Mock", pack_id: P1, position: 1, target_mock_count: 1, gate_score: null, group_id: GROUP })], group_members: inGroup ? [{ group_id: GROUP, user_id: "me", org_id: ORG }] : [] });
    expect((await myPlans(fakeDb(group(true)).db, me)).length).toBe(1);
    expect(await myPlans(fakeDb(group(false)).db, me)).toEqual([]);
  });
});
