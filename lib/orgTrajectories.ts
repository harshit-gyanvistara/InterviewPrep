import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { checkAudience, cohortNodes, countsFrom, reportRows, roundAvailable, waivedKey, waivers, ASSIGNEE_ROLE } from "./orgCohorts";
import { requireRole, type OrgRef } from "./orgInvites";
import { inScope } from "./orgSections";
import type { TrajectoryAssignBody, TrajectoryBody } from "./schemas";
import { planStages, type PlannedStage } from "./trajectory";

// Server-only. Trajectories: plans of stages that staff build and give to a section or group
// (plans/b2b-college.md B.6). Giving one out copies each stage into an assignment, so progress,
// stamping and the member's list reuse the assignment machinery, and later edits to the plan never
// change work already set. Everything needs assignments.create; groups also need cohorts.manage.

export interface StageView {
  id: string;
  position: number;
  title: string;
  packId: string;
  targetCount: number;
  dueDays: number | null;
  gateScore: number | null;
  mandatory: boolean;
}

export interface RunView {
  id: string;
  name: string;
  cohortId: string | null;
  groupId: string | null;
  startsAt: string;
}

export interface TrajectoryView {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  stages: StageView[];
  runs: RunView[];
}

/** One stage of a plan as a member sees it, with where they are in it. */
export interface PlanStageView {
  assignmentId: string;
  title: string;
  packId: string;
  position: number;
  mandatory: boolean;
  gateScore: number | null;
  target: number;
  done: number;
  dueAt: string | null;
  complete: boolean;
  locked: boolean;
  current: boolean;
  /** Mocks taken for this stage, counting or not, and the best score among those long enough to score. */
  attempts: number;
  bestScore: number | null;
  /** A coach excused this member from the stage, with a reason. */
  waived: boolean;
  waivedReason: string | null;
}

export interface PlanView {
  runId: string;
  orgId: string;
  orgName: string;
  name: string;
  stages: PlanStageView[];
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

const DAY_MS = 86_400_000;

async function checkStages(db: SupabaseClient, org: OrgRef, stages: TrajectoryBody["stages"]) {
  for (const [i, s] of stages.entries()) {
    if (!(await roundAvailable(db, org, s.packId))) throw new ApiError(400, `Stage ${i + 1}: pick one of the available rounds.`);
  }
}

const stageRows = (trajectoryId: string, stages: TrajectoryBody["stages"]) =>
  stages.map((s, i) => ({ trajectory_id: trajectoryId, position: i + 1, title: s.title, pack_id: s.packId, target_count: s.targetCount, due_days: s.dueDays, gate_score: s.gateScore, mandatory: s.mandatory }));

export async function listTrajectories(db: SupabaseClient, org: OrgRef): Promise<TrajectoryView[]> {
  requireRole(org, "assignments.create");
  const { data: plans, error } = await db.from("trajectories").select("id, name, description, archived").eq("org_id", org.id).order("created_at");
  fail("trajectories read", error);
  const ids = (plans ?? []).map((p) => p.id as string);
  const [stages, runs] = await Promise.all([
    ids.length ? db.from("trajectory_stages").select("id, trajectory_id, position, title, pack_id, target_count, due_days, gate_score, mandatory").in("trajectory_id", ids).order("position") : Promise.resolve({ data: [], error: null }),
    db.from("trajectory_runs").select("id, trajectory_id, name, cohort_id, group_id, starts_at").eq("org_id", org.id).order("created_at", { ascending: false }),
  ]);
  fail("trajectory_stages read", stages.error);
  fail("trajectory_runs read", runs.error);
  return (plans ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    archived: !!p.archived,
    stages: (stages.data ?? [])
      .filter((s) => s.trajectory_id === p.id)
      .map((s) => ({ id: s.id, position: s.position, title: s.title, packId: s.pack_id, targetCount: s.target_count, dueDays: s.due_days ?? null, gateScore: s.gate_score ?? null, mandatory: !!s.mandatory })),
    runs: (runs.data ?? []).filter((r) => r.trajectory_id === p.id).map((r) => ({ id: r.id, name: r.name, cohortId: r.cohort_id ?? null, groupId: r.group_id ?? null, startsAt: r.starts_at })),
  }));
}

export async function createTrajectory(db: SupabaseClient, user: AuthUser, org: OrgRef, body: TrajectoryBody): Promise<{ id: string }> {
  requireRole(org, "assignments.create");
  await checkStages(db, org, body.stages);
  const made = await db.from("trajectories").insert({ org_id: org.id, name: body.name, description: body.description, created_by: user.id }).select("id").single<{ id: string }>();
  fail("trajectories insert", made.error);
  const id = made.data!.id;
  fail("trajectory_stages insert", (await db.from("trajectory_stages").insert(stageRows(id, body.stages))).error);
  await audit(db, { orgId: org.id, actor: user, action: "trajectory.created", details: { trajectoryId: id, name: body.name, stages: body.stages.length } });
  return { id };
}

/** Replaces the plan's name, description and stages. Runs already given out keep their own copies. */
export async function updateTrajectory(db: SupabaseClient, user: AuthUser, org: OrgRef, trajectoryId: string, patch: Partial<TrajectoryBody> & { archived?: boolean }) {
  requireRole(org, "assignments.create");
  const { data: found, error } = await db.from("trajectories").select("id").eq("org_id", org.id).eq("id", trajectoryId).maybeSingle();
  fail("trajectories read", error);
  if (!found) throw new ApiError(404, "Plan not found.");
  if (patch.stages) await checkStages(db, org, patch.stages);
  const fields = Object.fromEntries(Object.entries({ name: patch.name, description: patch.description, archived: patch.archived }).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length) fail("trajectories update", (await db.from("trajectories").update(fields).eq("org_id", org.id).eq("id", trajectoryId)).error);
  if (patch.stages) {
    fail("trajectory_stages delete", (await db.from("trajectory_stages").delete().eq("trajectory_id", trajectoryId)).error);
    fail("trajectory_stages insert", (await db.from("trajectory_stages").insert(stageRows(trajectoryId, patch.stages))).error);
  }
  await audit(db, { orgId: org.id, actor: user, action: "trajectory.updated", details: { trajectoryId, fields: Object.keys(patch) } });
}

/** Gives the plan to an audience: one assignment per stage, due dates counted from the start. */
export async function assignTrajectory(db: SupabaseClient, user: AuthUser, org: OrgRef, trajectoryId: string, body: TrajectoryAssignBody): Promise<{ runId: string; stages: number }> {
  requireRole(org, "assignments.create");
  const { data: plan, error } = await db.from("trajectories").select("id, name").eq("org_id", org.id).eq("id", trajectoryId).eq("archived", false).maybeSingle<{ id: string; name: string }>();
  fail("trajectories read", error);
  if (!plan) throw new ApiError(404, "Plan not found.");
  const { data: stages, error: e2 } = await db.from("trajectory_stages").select("position, title, pack_id, target_count, due_days, gate_score, mandatory").eq("trajectory_id", trajectoryId).order("position");
  fail("trajectory_stages read", e2);
  if (!stages?.length) throw new ApiError(400, "This plan has no stages.");
  await checkAudience(db, org, body);
  // A round may have been archived since the plan was written.
  for (const s of stages) if (!(await roundAvailable(db, org, s.pack_id))) throw new ApiError(400, `"${s.title}" uses a round that is no longer available. Edit the plan first.`);

  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
  const run = await db
    .from("trajectory_runs")
    .insert({ org_id: org.id, trajectory_id: trajectoryId, name: plan.name, cohort_id: body.cohortId, group_id: body.groupId, starts_at: startsAt.toISOString(), created_by: user.id })
    .select("id")
    .single<{ id: string }>();
  fail("trajectory_runs insert", run.error);
  const runId = run.data!.id;
  const rows = stages.map((s) => ({
    org_id: org.id,
    cohort_id: body.cohortId,
    group_id: body.groupId,
    run_id: runId,
    position: s.position,
    pack_id: s.pack_id,
    title: `${plan.name} · ${s.title}`,
    due_at: s.due_days === null ? null : new Date(startsAt.getTime() + s.due_days * DAY_MS).toISOString(),
    target_mock_count: s.target_count,
    gate_score: s.gate_score,
    mandatory: s.mandatory,
    created_by: user.id,
  }));
  fail("assignments insert", (await db.from("assignments").insert(rows)).error);
  await audit(db, { orgId: org.id, actor: user, action: "trajectory.assigned", details: { trajectoryId, runId, cohortId: body.cohortId, groupId: body.groupId, stages: rows.length } });
  return { runId, stages: rows.length };
}

/** Takes a run back: its stage assignments go with it (mocks already taken stay in members' history). */
export async function deleteRun(db: SupabaseClient, user: AuthUser, org: OrgRef, runId: string) {
  requireRole(org, "assignments.create");
  const { data, error } = await db.from("trajectory_runs").delete().eq("org_id", org.id).eq("id", runId).select("id, name");
  fail("trajectory_runs delete", error);
  if (!data?.length) throw new ApiError(404, "Run not found.");
  await audit(db, { orgId: org.id, actor: user, action: "trajectory.run_deleted", details: { runId, name: data[0].name } });
}

/** The member's own plans: every stage of each run that applies to them, with progress and what's next. */
export async function myPlans(db: SupabaseClient, user: AuthUser): Promise<PlanView[]> {
  const { data: mems, error } = await db.from("memberships").select("org_id, cohort_id, organizations(name)").eq("user_id", user.id).eq("status", "active").eq("role", ASSIGNEE_ROLE);
  fail("memberships read", error);
  if (!mems?.length) return [];
  const orgIds = mems.map((m) => m.org_id as string);
  const [rows, mine] = await Promise.all([
    db.from("assignments").select("id, org_id, cohort_id, group_id, run_id, title, pack_id, position, due_at, target_mock_count, gate_score, mandatory").in("org_id", orgIds).order("position"),
    db.from("group_members").select("group_id").eq("user_id", user.id).in("org_id", orgIds),
  ]);
  fail("assignments read", rows.error);
  fail("group_members read", mine.error);
  const stages = (rows.data ?? []).filter((a) => a.run_id);
  if (!stages.length) return [];
  const [nodesByOrg, runs] = await Promise.all([
    Promise.all(orgIds.map(async (id) => [id, await cohortNodes(db, id)] as const)),
    db.from("trajectory_runs").select("id, name").in("id", [...new Set(stages.map((a) => a.run_id as string))]),
  ]);
  fail("trajectory_runs read", runs.error);
  const nodes = new Map(nodesByOrg);
  const groups = new Set((mine.data ?? []).map((g) => g.group_id as string));
  const applies = stages.filter((a) => {
    const m = mems.find((x) => x.org_id === a.org_id);
    return !!m && (a.group_id ? groups.has(a.group_id) : inScope(nodes.get(a.org_id) ?? [], m.cohort_id ?? null, a.cohort_id ?? null));
  });
  const [mocks, waived] = await Promise.all([reportRows(db, applies.map((a) => a.id), user.id), waivers(db, applies.map((a) => a.id), user.id)]);
  const counts = countsFrom(mocks, applies);
  const tries = new Map<string, { attempts: number; best: number | null }>();
  for (const r of mocks) {
    const t = tries.get(r.assignment_id) ?? { attempts: 0, best: null };
    t.attempts += 1;
    const overall = Number(r.data?.overall ?? 0);
    if (String(r.data?.verdict ?? "") !== "Too short" && (t.best === null || overall > t.best)) t.best = overall;
    tries.set(r.assignment_id, t);
  }

  const byRun = new Map<string, typeof applies>();
  for (const a of applies) byRun.set(a.run_id as string, [...(byRun.get(a.run_id as string) ?? []), a]);
  return [...byRun.entries()].map(([runId, list]) => {
    const planned: PlannedStage<{ position: number; done: number; target: number; mandatory: boolean; row: (typeof list)[number] }>[] = planStages(
      list.map((a) => ({ position: a.position ?? 0, done: waived.has(waivedKey(a.id, user.id)) ? a.target_mock_count : (counts.get(a.id)?.get(user.id) ?? 0), target: a.target_mock_count, mandatory: a.mandatory !== false, row: a })),
    );
    const org = mems.find((m) => m.org_id === list[0].org_id);
    return {
      runId,
      orgId: list[0].org_id as string,
      orgName: ((org?.organizations as unknown as { name: string } | null)?.name) ?? "",
      name: runs.data?.find((r) => r.id === runId)?.name ?? "Your plan",
      stages: planned.map(({ stage, complete, locked, current }) => ({
        assignmentId: stage.row.id,
        title: stage.row.title,
        packId: stage.row.pack_id,
        position: stage.position,
        mandatory: stage.mandatory,
        gateScore: stage.row.gate_score ?? null,
        target: stage.target,
        done: stage.done,
        dueAt: stage.row.due_at ?? null,
        complete,
        locked,
        current,
        attempts: tries.get(stage.row.id)?.attempts ?? 0,
        bestScore: tries.get(stage.row.id)?.best ?? null,
        waived: waived.has(waivedKey(stage.row.id, user.id)),
        waivedReason: waived.get(waivedKey(stage.row.id, user.id)) ?? null,
      })),
    };
  });
}
