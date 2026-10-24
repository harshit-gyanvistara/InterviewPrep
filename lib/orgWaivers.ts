import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { loadOrg } from "./orgDashboard";
import { requireRole, type OrgRef } from "./orgInvites";
import { myPlans, type PlanView } from "./orgTrajectories";
import { shareAllows } from "./permissions";

// Server-only. Waivers and a member's plan seen by staff (plans/b2b-college.md B.9). A waiver excuses one
// member from one assignment (a plan stage) for a stated reason; it counts as done and unlocks the next
// stage, but never touches reports, so scores are never faked. A coach can only act on members in their
// own part of the tree; the member sees the waiver and its reason on their plan.

export const REASON_MIN = 3;
export const REASON_MAX = 300;

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

export interface MemberPlans {
  /** The member shares less than scores, so their progress against score gates stays private. */
  hidden: boolean;
  plans: PlanView[];
}

/** The member in this org that the caller is allowed to see (a coach's part of the tree only), or a 404. */
async function visibleMember(db: SupabaseClient, org: OrgRef, memberId: string) {
  const data = await loadOrg(db, org);
  const m = data.members.find((x) => x.userId === memberId && x.role === "member");
  if (!m) throw new ApiError(404, "Member not found.");
  return m;
}

/** A member's plans with their progress, for staff who can view their reports. */
export async function memberPlans(db: SupabaseClient, org: OrgRef, memberId: string): Promise<MemberPlans> {
  requireRole(org, "members.view_reports");
  const m = await visibleMember(db, org, memberId);
  // Whether a score cleared a gate is derived from scores, so it follows the member's sharing choice.
  if (!shareAllows(m.shareLevel, "scores")) return { hidden: true, plans: [] };
  return { hidden: false, plans: (await myPlans(db, { id: memberId, email: m.email ?? "" })).filter((p) => p.orgId === org.id) };
}

export async function waiveStage(db: SupabaseClient, actor: AuthUser, org: OrgRef, memberId: string, assignmentId: string, reason: string) {
  requireRole(org, "assignments.create");
  const text = reason.trim();
  if (text.length < REASON_MIN || text.length > REASON_MAX) throw new ApiError(400, `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
  await visibleMember(db, org, memberId);
  const { data: a, error } = await db.from("assignments").select("id, run_id").eq("org_id", org.id).eq("id", assignmentId).maybeSingle<{ id: string; run_id: string | null }>();
  fail("assignments read", error);
  if (!a) throw new ApiError(404, "Assignment not found.");
  const res = await db.from("assignment_waivers").upsert({ assignment_id: assignmentId, user_id: memberId, org_id: org.id, reason: text, waived_by: actor.id }, { onConflict: "assignment_id,user_id" });
  fail("assignment_waivers upsert", res.error);
  await audit(db, { orgId: org.id, actor, action: "stage.waived", targetUserId: memberId, details: { assignmentId, reason: text } });
}

export async function unwaiveStage(db: SupabaseClient, actor: AuthUser, org: OrgRef, memberId: string, assignmentId: string) {
  requireRole(org, "assignments.create");
  await visibleMember(db, org, memberId);
  const { data, error } = await db.from("assignment_waivers").delete().eq("org_id", org.id).eq("assignment_id", assignmentId).eq("user_id", memberId).select("assignment_id");
  fail("assignment_waivers delete", error);
  if (!data?.length) throw new ApiError(404, "No waiver to remove.");
  await audit(db, { orgId: org.id, actor, action: "stage.unwaived", targetUserId: memberId, details: { assignmentId } });
}
