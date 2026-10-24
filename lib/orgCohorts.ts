import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { getCatalog } from "./catalog-server";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { orgPackExists } from "./orgPacks";
import { qualifies } from "./trajectory";
import { requireRole, type OrgRef } from "./orgInvites";
import { checkParent, inScope, pathLabel, treeOrder, descendantIds, type CohortNode } from "./orgSections";
import { roleCan } from "./permissions";
import type { AssignmentCreateBody } from "./schemas";

// Server-only. Cohorts, member placement and assignments (plans/m2-org.md O.5). Admins manage
// cohorts and who's in them; coaches and admins set assignments, a coach only for their own
// cohort when they have one. Members see their open assignments with their own progress.

export interface CohortView {
  id: string;
  name: string;
  archived: boolean;
  parentId: string | null;
  /** "CSE / 2027 / A": the names from the top of the tree down. */
  path: string;
  /** Members placed directly in it, and in it plus every section below it. */
  members: number;
  membersTotal: number;
}

export interface GroupView {
  id: string;
  name: string;
  archived: boolean;
  members: number;
  memberIds: string[];
}

export interface MemberView {
  userId: string;
  email: string | null;
  role: string;
  cohortId: string | null;
}

export interface AssignmentView {
  id: string;
  title: string;
  packId: string;
  cohortId: string | null;
  groupId: string | null;
  /** The trajectory run this is a stage of, if any. */
  runId: string | null;
  /** Score a mock must reach to count (trajectory stages), or null. */
  gateScore: number | null;
  dueAt: string | null;
  targetMockCount: number;
  createdAt: string;
  /** Members who have done at least the target number of mocks for it. */
  completedBy: number;
  /** Members it applies to (its cohort, or everyone). */
  assignedTo: number;
}

/** An open assignment as the member sees it, with their own progress. */
export interface MyAssignment {
  id: string;
  orgId: string;
  orgName: string;
  title: string;
  packId: string;
  dueAt: string | null;
  target: number;
  done: number;
  /** Score a mock must reach to count, or null when any mock does. */
  gateScore: number | null;
}

/** Who assignments are for: members. Owners, admins and coaches set the work; they don't count toward it. */
export const ASSIGNEE_ROLE = "member";

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

const email = (u: unknown) => (u && typeof u === "object" && "email" in u ? ((u as { email: string | null }).email ?? null) : null);

// ---- cohorts ----

/** The org's cohorts as a tree (archived ones included, so paths and scopes stay whole). */
export async function cohortNodes(db: SupabaseClient, orgId: string): Promise<CohortNode[]> {
  const { data, error } = await db.from("cohorts").select("id, name, parent_id, archived").eq("org_id", orgId).order("created_at");
  fail("cohorts read", error);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id ?? null, archived: !!c.archived }));
}

export async function listCohorts(db: SupabaseClient, org: OrgRef): Promise<CohortView[]> {
  if (!roleCan(org.role, "cohorts.manage") && !roleCan(org.role, "assignments.create")) throw new ApiError(403, "You don't have access to this.");
  const [nodes, members] = await Promise.all([cohortNodes(db, org.id), db.from("memberships").select("cohort_id").eq("org_id", org.id).eq("status", "active")]);
  fail("memberships read", members.error);
  const placed = (members.data ?? []).map((m) => m.cohort_id as string | null);
  return treeOrder(nodes).map((c) => ({
    id: c.id,
    name: c.name,
    archived: !!c.archived,
    parentId: c.parentId,
    path: pathLabel(nodes, c.id),
    members: placed.filter((id) => id === c.id).length,
    membersTotal: placed.filter((id) => id !== null && descendantIds(nodes, c.id).includes(id)).length,
  }));
}

export async function createCohort(db: SupabaseClient, user: AuthUser, org: OrgRef, name: string, parentId: string | null = null): Promise<{ id: string }> {
  requireRole(org, "cohorts.manage");
  if (parentId) {
    const problem = checkParent(await cohortNodes(db, org.id), null, parentId);
    if (problem) throw new ApiError(400, problem);
  }
  const { data, error } = await db.from("cohorts").insert({ org_id: org.id, name, parent_id: parentId }).select("id").single();
  fail("cohorts insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "cohort.created", details: { name, parentId } });
  return { id: data!.id };
}

export async function updateCohort(db: SupabaseClient, user: AuthUser, org: OrgRef, cohortId: string, patch: { name?: string; archived?: boolean; parentId?: string | null }) {
  requireRole(org, "cohorts.manage");
  const { parentId, ...rest } = patch;
  if (parentId !== undefined) {
    const nodes = await cohortNodes(db, org.id);
    if (!nodes.some((n) => n.id === cohortId)) throw new ApiError(404, "Cohort not found.");
    const problem = checkParent(nodes, cohortId, parentId);
    if (problem) throw new ApiError(400, problem);
  }
  const { data, error } = await db.from("cohorts").update({ ...rest, ...(parentId !== undefined ? { parent_id: parentId } : {}) }).eq("org_id", org.id).eq("id", cohortId).select("id");
  fail("cohorts update", error);
  if (!data?.length) throw new ApiError(404, "Cohort not found.");
  await audit(db, { orgId: org.id, actor: user, action: "cohort.updated", details: { cohortId, ...patch } });
}

// ---- groups: ad-hoc, overlapping sets of members ----

export async function listGroups(db: SupabaseClient, org: OrgRef): Promise<GroupView[]> {
  requireRole(org, "cohorts.manage");
  const [groups, members] = await Promise.all([
    db.from("groups").select("id, name, archived").eq("org_id", org.id).order("created_at"),
    db.from("group_members").select("group_id, user_id").eq("org_id", org.id),
  ]);
  fail("groups read", groups.error);
  fail("group_members read", members.error);
  return (groups.data ?? []).map((g) => {
    const memberIds = (members.data ?? []).filter((m) => m.group_id === g.id).map((m) => m.user_id as string);
    return { id: g.id, name: g.name, archived: !!g.archived, members: memberIds.length, memberIds };
  });
}

/** Makes the group's members exactly `memberIds` (only active members of this org are kept). */
async function setGroupMembers(db: SupabaseClient, org: OrgRef, groupId: string, memberIds: string[]) {
  const [active, current] = await Promise.all([
    db.from("memberships").select("user_id").eq("org_id", org.id).eq("status", "active"),
    db.from("group_members").select("user_id").eq("group_id", groupId),
  ]);
  fail("memberships read", active.error);
  fail("group_members read", current.error);
  const ok = new Set((active.data ?? []).map((m) => m.user_id as string));
  const want = new Set(memberIds.filter((id) => ok.has(id)));
  const have = new Set((current.data ?? []).map((m) => m.user_id as string));
  const add = [...want].filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !want.has(id));
  if (add.length) fail("group_members insert", (await db.from("group_members").insert(add.map((user_id) => ({ group_id: groupId, user_id, org_id: org.id })))).error);
  if (drop.length) fail("group_members delete", (await db.from("group_members").delete().eq("group_id", groupId).in("user_id", drop)).error);
}

export async function createGroup(db: SupabaseClient, user: AuthUser, org: OrgRef, name: string, memberIds: string[] = []): Promise<{ id: string }> {
  requireRole(org, "cohorts.manage");
  const { data, error } = await db.from("groups").insert({ org_id: org.id, name }).select("id").single();
  fail("groups insert", error);
  if (memberIds.length) await setGroupMembers(db, org, data!.id, memberIds);
  await audit(db, { orgId: org.id, actor: user, action: "group.created", details: { name, members: memberIds.length } });
  return { id: data!.id };
}

export async function updateGroup(db: SupabaseClient, user: AuthUser, org: OrgRef, groupId: string, patch: { name?: string; archived?: boolean; memberIds?: string[] }) {
  requireRole(org, "cohorts.manage");
  const { memberIds, ...rest } = patch;
  const { data: found, error } = await db.from("groups").select("id").eq("org_id", org.id).eq("id", groupId).maybeSingle();
  fail("groups read", error);
  if (!found) throw new ApiError(404, "Group not found.");
  if (Object.keys(rest).length) fail("groups update", (await db.from("groups").update(rest).eq("org_id", org.id).eq("id", groupId)).error);
  if (memberIds) await setGroupMembers(db, org, groupId, memberIds);
  await audit(db, { orgId: org.id, actor: user, action: "group.updated", details: { groupId, ...rest, members: memberIds?.length } });
}

// ---- members (placement only; roles and removal come with the dashboard, O.6) ----

export async function listMembers(db: SupabaseClient, org: OrgRef): Promise<MemberView[]> {
  requireRole(org, "cohorts.manage");
  const { data, error } = await db.from("memberships").select("user_id, role, cohort_id, users(email)").eq("org_id", org.id).eq("status", "active").order("joined_at");
  fail("memberships read", error);
  return (data ?? []).map((m) => ({ userId: m.user_id, email: email(m.users), role: m.role, cohortId: m.cohort_id }));
}

/** Moves an active member into a cohort of this org, or out of any (null). */
export async function setMemberCohort(db: SupabaseClient, user: AuthUser, org: OrgRef, memberId: string, cohortId: string | null) {
  requireRole(org, "cohorts.manage");
  if (cohortId) {
    const { data, error } = await db.from("cohorts").select("id").eq("org_id", org.id).eq("id", cohortId).maybeSingle();
    fail("cohorts read", error);
    if (!data) throw new ApiError(404, "Cohort not found.");
  }
  const { data, error } = await db.from("memberships").update({ cohort_id: cohortId }).eq("org_id", org.id).eq("user_id", memberId).eq("status", "active").select("user_id");
  fail("memberships update", error);
  if (!data?.length) throw new ApiError(404, "Member not found.");
  await audit(db, { orgId: org.id, actor: user, action: "member.cohort_set", targetUserId: memberId, details: { cohortId } });
}

// ---- assignments ----

export interface ReportRow {
  assignment_id: string;
  user_id: string;
  data: { overall?: unknown; verdict?: unknown } | null;
}

/** The reports stamped with these assignments (optionally one member's). */
export async function reportRows(db: SupabaseClient, assignmentIds: string[], userId?: string): Promise<ReportRow[]> {
  if (!assignmentIds.length) return [];
  let q = db.from("reports").select("assignment_id, user_id, data").in("assignment_id", assignmentIds);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  fail("reports read", error);
  return (data ?? []) as ReportRow[];
}

const lite = (r: ReportRow) => ({ overall: Number(r.data?.overall ?? 0), verdict: String(r.data?.verdict ?? "") });

/**
 * Counts per member of mocks that count toward each assignment. One with a gate (a plan stage) counts
 * only mocks that reach it; one without counts every mock.
 */
export function countsFrom(rows: ReportRow[], assignments: { id: string; gate_score?: number | null }[]): Map<string, Map<string, number>> {
  const gates = new Map(assignments.map((a) => [a.id, a.gate_score ?? null]));
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const gate = gates.get(r.assignment_id) ?? null;
    if (gate !== null && !qualifies(lite(r), gate)) continue;
    const per = out.get(r.assignment_id) ?? new Map<string, number>();
    per.set(r.user_id, (per.get(r.user_id) ?? 0) + 1);
    out.set(r.assignment_id, per);
  }
  return out;
}

export async function reportCounts(db: SupabaseClient, assignments: { id: string; gate_score?: number | null }[], userId?: string): Promise<Map<string, Map<string, number>>> {
  return countsFrom(await reportRows(db, assignments.map((a) => a.id), userId), assignments);
}

/** Who is excused from what: `waivedKey(assignmentId, userId)` -> reason. */
export const waivedKey = (assignmentId: string, userId: string) => `${assignmentId}:${userId}`;

export async function waivers(db: SupabaseClient, assignmentIds: string[], userId?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!assignmentIds.length) return out;
  let q = db.from("assignment_waivers").select("assignment_id, user_id, reason").in("assignment_id", assignmentIds);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  fail("assignment_waivers read", error);
  for (const w of data ?? []) out.set(waivedKey(w.assignment_id, w.user_id), w.reason);
  return out;
}

export async function listAssignments(db: SupabaseClient, org: OrgRef): Promise<AssignmentView[]> {
  requireRole(org, "assignments.create");
  const [assignments, members, nodes, groupMembers] = await Promise.all([
    db.from("assignments").select("id, title, pack_id, cohort_id, group_id, due_at, target_mock_count, created_at, run_id, gate_score").eq("org_id", org.id).order("created_at", { ascending: false }),
    db.from("memberships").select("user_id, cohort_id, role").eq("org_id", org.id).eq("status", "active"),
    cohortNodes(db, org.id),
    db.from("group_members").select("group_id, user_id").eq("org_id", org.id),
  ]);
  fail("assignments read", assignments.error);
  fail("memberships read", members.error);
  fail("group_members read", groupMembers.error);
  const rows = assignments.data ?? [];
  const [counts, waived] = await Promise.all([reportCounts(db, rows), waivers(db, rows.map((a) => a.id))]);
  return rows.map((a) => {
    const inGroup = new Set((groupMembers.data ?? []).filter((g) => g.group_id === a.group_id).map((g) => g.user_id as string));
    const audience = (members.data ?? []).filter((m) => m.role === ASSIGNEE_ROLE && (a.group_id ? inGroup.has(m.user_id) : inScope(nodes, m.cohort_id ?? null, a.cohort_id ?? null)));
    const per = counts.get(a.id) ?? new Map<string, number>();
    return {
      id: a.id,
      title: a.title,
      packId: a.pack_id,
      cohortId: a.cohort_id,
      groupId: a.group_id ?? null,
      runId: a.run_id ?? null,
      gateScore: a.gate_score ?? null,
      dueAt: a.due_at,
      targetMockCount: a.target_mock_count,
      createdAt: a.created_at,
      assignedTo: audience.length,
      completedBy: audience.filter((m) => (per.get(m.user_id) ?? 0) >= a.target_mock_count || waived.has(waivedKey(a.id, m.user_id))).length,
    };
  });
}

/**
 * Checks who an assignment (or a trajectory) is for: a coach placed in a cohort may only pick that
 * cohort or a section below it; a cohort must belong to the org; a group needs cohorts.manage and
 * must be an active group of the org. Throws the right 4xx otherwise.
 */
export async function checkAudience(db: SupabaseClient, org: OrgRef, audience: { cohortId: string | null; groupId: string | null }, nodes?: CohortNode[]) {
  const tree = nodes ?? (await cohortNodes(db, org.id));
  if (org.role === "coach" && org.cohortId && !inScope(tree, audience.cohortId, org.cohortId)) throw new ApiError(403, "Coaches can only set assignments for their own cohort.");
  if (audience.cohortId && !tree.some((n) => n.id === audience.cohortId)) throw new ApiError(404, "Cohort not found.");
  if (audience.groupId) {
    requireRole(org, "cohorts.manage");
    const { data, error } = await db.from("groups").select("id").eq("org_id", org.id).eq("id", audience.groupId).eq("archived", false).maybeSingle();
    fail("groups read", error);
    if (!data) throw new ApiError(404, "Group not found.");
  }
}

/** Is this a built-in round or one of the org's own (not archived)? */
export async function roundAvailable(db: SupabaseClient, org: OrgRef, packId: string): Promise<boolean> {
  return (await getCatalog()).packs.some((p) => p.id === packId) || (await orgPackExists(db, org.id, packId));
}

export async function createAssignment(db: SupabaseClient, user: AuthUser, org: OrgRef, body: AssignmentCreateBody): Promise<{ id: string }> {
  requireRole(org, "assignments.create");
  await checkAudience(db, org, body);
  if (!(await roundAvailable(db, org, body.packId))) throw new ApiError(400, "Pick one of the available rounds.");
  const { data, error } = await db
    .from("assignments")
    .insert({ org_id: org.id, cohort_id: body.cohortId, group_id: body.groupId, pack_id: body.packId, title: body.title, due_at: body.dueAt, target_mock_count: body.targetMockCount, created_by: user.id })
    .select("id")
    .single();
  fail("assignments insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "assignment.created", details: { title: body.title, packId: body.packId, cohortId: body.cohortId, groupId: body.groupId } });
  return { id: data!.id };
}

export async function deleteAssignment(db: SupabaseClient, user: AuthUser, org: OrgRef, assignmentId: string) {
  requireRole(org, "assignments.create");
  const { data, error } = await db.from("assignments").delete().eq("org_id", org.id).eq("id", assignmentId).select("id, title");
  fail("assignments delete", error);
  if (!data?.length) throw new ApiError(404, "Assignment not found.");
  await audit(db, { orgId: org.id, actor: user, action: "assignment.deleted", details: { assignmentId, title: data[0].title } });
}

/**
 * The user's open assignments across their orgs: for everyone or their cohort, not yet done the
 * target number of times. Overdue ones are kept (marked by their due date) until done.
 */
export async function myAssignments(db: SupabaseClient, user: AuthUser): Promise<MyAssignment[]> {
  const { data: mems, error } = await db.from("memberships").select("org_id, cohort_id, organizations(name)").eq("user_id", user.id).eq("status", "active").eq("role", ASSIGNEE_ROLE);
  fail("memberships read", error);
  if (!mems?.length) return [];
  const orgIds = mems.map((m) => m.org_id as string);
  const [assignmentRows, cohortRows, myGroups] = await Promise.all([
    db.from("assignments").select("id, org_id, cohort_id, group_id, title, pack_id, due_at, target_mock_count, gate_score").in("org_id", orgIds).order("due_at", { ascending: true, nullsFirst: false }),
    db.from("cohorts").select("id, name, org_id, parent_id, archived").in("org_id", orgIds),
    db.from("group_members").select("group_id").eq("user_id", user.id).in("org_id", orgIds),
  ]);
  fail("assignments read", assignmentRows.error);
  fail("cohorts read", cohortRows.error);
  fail("group_members read", myGroups.error);
  const nodes: CohortNode[] = (cohortRows.data ?? []).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id ?? null, archived: !!c.archived }));
  const groups = new Set((myGroups.data ?? []).map((g) => g.group_id as string));
  const mine = (assignmentRows.data ?? []).filter((a) => {
    const m = mems.find((x) => x.org_id === a.org_id);
    if (!m) return false;
    return a.group_id ? groups.has(a.group_id) : inScope(nodes, m.cohort_id ?? null, a.cohort_id ?? null);
  });
  const [counts, waived] = await Promise.all([reportCounts(db, mine, user.id), waivers(db, mine.map((a) => a.id), user.id)]);
  return mine
    .filter((a) => !waived.has(waivedKey(a.id, user.id)))
    .map((a) => ({
      id: a.id,
      orgId: a.org_id,
      orgName: ((mems.find((m) => m.org_id === a.org_id)?.organizations as unknown as { name: string } | null)?.name) ?? "",
      title: a.title,
      packId: a.pack_id,
      dueAt: a.due_at,
      target: a.target_mock_count,
      done: counts.get(a.id)?.get(user.id) ?? 0,
      gateScore: a.gate_score ?? null,
    }))
    .filter((a) => a.done < a.target);
}
