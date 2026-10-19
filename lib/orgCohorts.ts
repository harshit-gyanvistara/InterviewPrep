import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { getCatalog } from "./catalog-server";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { requireRole, type OrgRef } from "./orgInvites";
import { roleCan } from "./permissions";
import type { AssignmentCreateBody } from "./schemas";

// Server-only. Cohorts, member placement and assignments (plans/m2-org.md O.5). Admins manage
// cohorts and who's in them; coaches and admins set assignments, a coach only for their own
// cohort when they have one. Members see their open assignments with their own progress.

export interface CohortView {
  id: string;
  name: string;
  archived: boolean;
  members: number;
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
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

const email = (u: unknown) => (u && typeof u === "object" && "email" in u ? ((u as { email: string | null }).email ?? null) : null);

// ---- cohorts ----

export async function listCohorts(db: SupabaseClient, org: OrgRef): Promise<CohortView[]> {
  if (!roleCan(org.role, "cohorts.manage") && !roleCan(org.role, "assignments.create")) throw new ApiError(403, "You don't have access to this.");
  const [cohorts, members] = await Promise.all([
    db.from("cohorts").select("id, name, archived").eq("org_id", org.id).order("created_at"),
    db.from("memberships").select("cohort_id").eq("org_id", org.id).eq("status", "active"),
  ]);
  fail("cohorts read", cohorts.error);
  fail("memberships read", members.error);
  return (cohorts.data ?? []).map((c) => ({ ...c, members: (members.data ?? []).filter((m) => m.cohort_id === c.id).length }));
}

export async function createCohort(db: SupabaseClient, user: AuthUser, org: OrgRef, name: string): Promise<{ id: string }> {
  requireRole(org, "cohorts.manage");
  const { data, error } = await db.from("cohorts").insert({ org_id: org.id, name }).select("id").single();
  fail("cohorts insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "cohort.created", details: { name } });
  return { id: data!.id };
}

export async function updateCohort(db: SupabaseClient, user: AuthUser, org: OrgRef, cohortId: string, patch: { name?: string; archived?: boolean }) {
  requireRole(org, "cohorts.manage");
  const { data, error } = await db.from("cohorts").update(patch).eq("org_id", org.id).eq("id", cohortId).select("id");
  fail("cohorts update", error);
  if (!data?.length) throw new ApiError(404, "Cohort not found.");
  await audit(db, { orgId: org.id, actor: user, action: "cohort.updated", details: { cohortId, ...patch } });
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

/** Counts per member of finished mocks (reports) for each assignment. */
async function reportCounts(db: SupabaseClient, assignmentIds: string[], userId?: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!assignmentIds.length) return out;
  let q = db.from("reports").select("assignment_id, user_id").in("assignment_id", assignmentIds);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  fail("reports read", error);
  for (const r of data ?? []) {
    const per = out.get(r.assignment_id) ?? new Map<string, number>();
    per.set(r.user_id, (per.get(r.user_id) ?? 0) + 1);
    out.set(r.assignment_id, per);
  }
  return out;
}

export async function listAssignments(db: SupabaseClient, org: OrgRef): Promise<AssignmentView[]> {
  requireRole(org, "assignments.create");
  const [assignments, members] = await Promise.all([
    db.from("assignments").select("id, title, pack_id, cohort_id, due_at, target_mock_count, created_at").eq("org_id", org.id).order("created_at", { ascending: false }),
    db.from("memberships").select("user_id, cohort_id").eq("org_id", org.id).eq("status", "active"),
  ]);
  fail("assignments read", assignments.error);
  fail("memberships read", members.error);
  const rows = assignments.data ?? [];
  const counts = await reportCounts(db, rows.map((a) => a.id));
  return rows.map((a) => {
    const audience = (members.data ?? []).filter((m) => !a.cohort_id || m.cohort_id === a.cohort_id);
    const per = counts.get(a.id) ?? new Map<string, number>();
    return {
      id: a.id,
      title: a.title,
      packId: a.pack_id,
      cohortId: a.cohort_id,
      dueAt: a.due_at,
      targetMockCount: a.target_mock_count,
      createdAt: a.created_at,
      assignedTo: audience.length,
      completedBy: audience.filter((m) => (per.get(m.user_id) ?? 0) >= a.target_mock_count).length,
    };
  });
}

export async function createAssignment(db: SupabaseClient, user: AuthUser, org: OrgRef, body: AssignmentCreateBody): Promise<{ id: string }> {
  requireRole(org, "assignments.create");
  // A coach placed in a cohort sets work for that cohort only.
  if (org.role === "coach" && org.cohortId && body.cohortId !== org.cohortId) throw new ApiError(403, "Coaches can only set assignments for their own cohort.");
  if (body.cohortId) {
    const { data, error } = await db.from("cohorts").select("id").eq("org_id", org.id).eq("id", body.cohortId).maybeSingle();
    fail("cohorts read", error);
    if (!data) throw new ApiError(404, "Cohort not found.");
  }
  // Built-in rounds only for now; org-authored rounds come with their authoring UI.
  if (!(await getCatalog()).packs.some((p) => p.id === body.packId)) throw new ApiError(400, "Pick one of Offerly's rounds.");
  const { data, error } = await db
    .from("assignments")
    .insert({ org_id: org.id, cohort_id: body.cohortId, pack_id: body.packId, title: body.title, due_at: body.dueAt, target_mock_count: body.targetMockCount, created_by: user.id })
    .select("id")
    .single();
  fail("assignments insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "assignment.created", details: { title: body.title, packId: body.packId, cohortId: body.cohortId } });
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
  const { data: mems, error } = await db.from("memberships").select("org_id, cohort_id, organizations(name)").eq("user_id", user.id).eq("status", "active");
  fail("memberships read", error);
  if (!mems?.length) return [];
  const { data: rows, error: e2 } = await db
    .from("assignments")
    .select("id, org_id, cohort_id, title, pack_id, due_at, target_mock_count")
    .in("org_id", mems.map((m) => m.org_id))
    .order("due_at", { ascending: true, nullsFirst: false });
  fail("assignments read", e2);
  const mine = (rows ?? []).filter((a) => {
    const m = mems.find((x) => x.org_id === a.org_id);
    return m && (!a.cohort_id || a.cohort_id === m.cohort_id);
  });
  const counts = await reportCounts(db, mine.map((a) => a.id), user.id);
  return mine
    .map((a) => ({
      id: a.id,
      orgId: a.org_id,
      orgName: ((mems.find((m) => m.org_id === a.org_id)?.organizations as unknown as { name: string } | null)?.name) ?? "",
      title: a.title,
      packId: a.pack_id,
      dueAt: a.due_at,
      target: a.target_mock_count,
      done: counts.get(a.id)?.get(user.id) ?? 0,
    }))
    .filter((a) => a.done < a.target);
}
