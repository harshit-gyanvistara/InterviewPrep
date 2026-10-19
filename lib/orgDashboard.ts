import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { analytics, inactive, memberRow, membersCsv, visibleReport, type CohortStats, type MemberRow, type OrgMember, type OrgReport, type VisibleReport } from "./orgAnalytics";
import { listAssignments, setMemberCohort, type AssignmentView } from "./orgCohorts";
import { requireRole, type OrgRef } from "./orgInvites";
import { DEFAULT_SHARE_LEVEL, isShareLevel, roleCan, shareAllows, type ShareLevel } from "./permissions";
import { checkOrgEntitlement, type MeterStatus } from "./policies";
import type { Message } from "./types";

// Server-only. The org admin dashboard (plans/m2-org.md O.6). Everything here reads with the
// secret key after the caller's permission is checked, and every member's data is cut to their
// share level by lib/orgAnalytics.ts. Opening one member and exporting are written to audit_logs.
// Only practice done for this org (rows stamped with its org_id) is ever read.

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};
const emailOf = (u: unknown) => (u && typeof u === "object" && "email" in u ? ((u as { email: string | null }).email ?? null) : null);

export interface Dashboard {
  overview: {
    activeMembers: number;
    seats: number | null;
    mocks: MeterStatus;
    inactive: { userId: string; email: string | null }[];
    assignments: { open: number; completionRate: number | null };
  };
  members: MemberRow[];
  analytics: CohortStats[];
  cohorts: { id: string; name: string }[];
}

interface OrgData {
  members: OrgMember[];
  reports: OrgReport[];
  cohorts: { id: string; name: string }[];
}

/** A coach placed in a cohort sees only that cohort; everyone else with access sees the whole org. */
const scope = (org: OrgRef) => (org.role === "coach" && org.cohortId ? org.cohortId : null);

async function loadOrg(db: SupabaseClient, org: OrgRef): Promise<OrgData> {
  const [mems, consents, reps, cohorts] = await Promise.all([
    db.from("memberships").select("user_id, role, cohort_id, joined_at, users(email)").eq("org_id", org.id).eq("status", "active").order("joined_at"),
    db.from("consents").select("user_id, value, granted_at").eq("org_id", org.id).eq("kind", "org_share").is("revoked_at", null).order("granted_at", { ascending: false }),
    db.from("reports").select("user_id, data").eq("org_id", org.id),
    db.from("cohorts").select("id, name").eq("org_id", org.id).eq("archived", false).order("created_at"),
  ]);
  fail("memberships read", mems.error);
  fail("consents read", consents.error);
  fail("reports read", reps.error);
  fail("cohorts read", cohorts.error);

  const level = new Map<string, ShareLevel>();
  for (const c of consents.data ?? []) {
    const l = (c.value as { shareLevel?: unknown } | null)?.shareLevel;
    if (!level.has(c.user_id) && isShareLevel(l)) level.set(c.user_id, l);
  }
  const only = scope(org);
  const members: OrgMember[] = (mems.data ?? [])
    .map((m) => ({ userId: m.user_id, email: emailOf(m.users), role: m.role, cohortId: m.cohort_id, joinedAt: m.joined_at, shareLevel: level.get(m.user_id) ?? DEFAULT_SHARE_LEVEL }))
    .filter((m) => !only || m.cohortId === only);
  const ids = new Set(members.map((m) => m.userId));
  const reports: OrgReport[] = (reps.data ?? [])
    .filter((r) => ids.has(r.user_id))
    .map((r) => {
      const d = r.data as Record<string, unknown>;
      const signals = d.signals as { fillerRate?: unknown } | undefined;
      return {
        userId: r.user_id,
        sessionId: String(d.sessionId ?? ""),
        createdAt: Number(d.createdAt ?? 0),
        packId: String(d.packId ?? ""),
        overall: Number(d.overall ?? 0),
        verdict: String(d.verdict ?? ""),
        dimensions: Array.isArray(d.dimensions) ? (d.dimensions as OrgReport["dimensions"]) : [],
        fillerRate: typeof signals?.fillerRate === "number" ? signals.fillerRate : null,
      };
    });
  return { members, reports, cohorts: (cohorts.data ?? []).filter((c) => !only || c.id === only) };
}

export async function dashboard(db: SupabaseClient, org: OrgRef): Promise<Dashboard> {
  requireRole(org, "analytics.view");
  const [data, assignments, mocks, seats] = await Promise.all([
    loadOrg(db, org),
    roleCan(org.role, "assignments.create") ? listAssignments(db, org) : Promise.resolve([] as AssignmentView[]),
    checkOrgEntitlement(org.id, "mocks"),
    db.from("entitlements").select("limit").eq("org_id", org.id).eq("key", "seats").maybeSingle(),
  ]);
  fail("entitlements read", seats.error);
  const rows = data.members.map((m) => memberRow(m, data.reports));
  const totals = assignments.reduce((t, a) => ({ done: t.done + a.completedBy, of: t.of + a.assignedTo }), { done: 0, of: 0 });
  return {
    overview: {
      activeMembers: data.members.length,
      seats: seats.data?.limit ?? null,
      mocks,
      inactive: inactive(rows).map((r) => ({ userId: r.userId, email: r.email })),
      assignments: { open: assignments.length, completionRate: totals.of ? Math.round((totals.done / totals.of) * 100) : null },
    },
    members: rows,
    analytics: analytics(data.members, data.reports, data.cohorts),
    cohorts: data.cohorts,
  };
}

export interface MemberDetail {
  member: MemberRow;
  reports: VisibleReport[];
  /** Transcripts of org practice, only when the member shares "full". */
  transcripts: { sessionId: string; messages: Pick<Message, "role" | "text">[] }[] | null;
}

/** One member's org practice at their share level. Written to audit_logs (member.viewed). */
export async function memberDetail(db: SupabaseClient, viewer: AuthUser, org: OrgRef, memberId: string): Promise<MemberDetail> {
  requireRole(org, "members.view_reports");
  const data = await loadOrg(db, org);
  const m = data.members.find((x) => x.userId === memberId);
  if (!m) throw new ApiError(404, "Member not found.");
  const mine = data.reports.filter((r) => r.userId === memberId).sort((a, b) => b.createdAt - a.createdAt);
  let transcripts: MemberDetail["transcripts"] = null;
  if (shareAllows(m.shareLevel, "full")) {
    const { data: sessions, error } = await db.from("sessions").select("id, data").eq("org_id", org.id).eq("user_id", memberId);
    fail("sessions read", error);
    transcripts = (sessions ?? []).map((s) => ({
      sessionId: s.id,
      messages: ((s.data as { messages?: Message[] }).messages ?? []).map((x) => ({ role: x.role, text: x.text })),
    }));
  }
  await audit(db, { orgId: org.id, actor: viewer, action: "member.viewed", targetUserId: memberId, details: { shareLevel: m.shareLevel } });
  return { member: memberRow(m, data.reports), reports: mine.map((r) => visibleReport(r, m.shareLevel)), transcripts };
}

/** CSV of members at their share levels. Written to audit_logs (org.exported). */
export async function exportCsv(db: SupabaseClient, user: AuthUser, org: OrgRef): Promise<string> {
  requireRole(org, "analytics.view");
  const data = await loadOrg(db, org);
  const names = new Map(data.cohorts.map((c) => [c.id, c.name]));
  await audit(db, { orgId: org.id, actor: user, action: "org.exported", details: { members: data.members.length } });
  return membersCsv(data.members.map((m) => memberRow(m, data.reports)), (id) => (id ? (names.get(id) ?? "") : ""));
}

async function activeOwners(db: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await db.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "owner").eq("status", "active");
  fail("memberships read", error);
  return (data ?? []).map((r) => r.user_id);
}

async function memberRole(db: SupabaseClient, orgId: string, memberId: string): Promise<string> {
  const { data, error } = await db.from("memberships").select("role").eq("org_id", orgId).eq("user_id", memberId).eq("status", "active").maybeSingle();
  fail("memberships read", error);
  if (!data) throw new ApiError(404, "Member not found.");
  return data.role;
}

/**
 * Changes a member's role and/or cohort. Roles need members.manage; only owners make or unmake
 * owners, and the last owner can't be demoted.
 */
export async function updateMember(db: SupabaseClient, user: AuthUser, org: OrgRef, memberId: string, patch: { role?: string; cohortId?: string | null }) {
  if (patch.role !== undefined) {
    requireRole(org, "members.manage");
    const current = await memberRole(db, org.id, memberId);
    if ((patch.role === "owner" || current === "owner") && !roleCan(org.role, "org.billing")) throw new ApiError(403, "Only an owner can change who's an owner.");
    if (current === "owner" && patch.role !== "owner" && (await activeOwners(db, org.id)).length <= 1) throw new ApiError(409, "This is the only owner. Make someone else an owner first.");
    if (patch.role !== current) {
      const { error } = await db.from("memberships").update({ role: patch.role }).eq("org_id", org.id).eq("user_id", memberId);
      fail("memberships update", error);
      await audit(db, { orgId: org.id, actor: user, action: "member.role_set", targetUserId: memberId, details: { from: current, to: patch.role } });
    }
  }
  if (patch.cohortId !== undefined) await setMemberCohort(db, user, org, memberId, patch.cohortId);
}

/** Removes a member: membership removed, their sharing consent revoked; their history stays theirs. */
export async function removeMember(db: SupabaseClient, user: AuthUser, org: OrgRef, memberId: string) {
  requireRole(org, "members.manage");
  if (memberId === user.id) throw new ApiError(400, "To leave, use Settings → Organisations.");
  const role = await memberRole(db, org.id, memberId);
  if (role === "owner" && !roleCan(org.role, "org.billing")) throw new ApiError(403, "Only an owner can remove an owner.");
  if (role === "owner" && (await activeOwners(db, org.id)).length <= 1) throw new ApiError(409, "This is the only owner.");
  fail("memberships update", (await db.from("memberships").update({ status: "removed" }).eq("org_id", org.id).eq("user_id", memberId)).error);
  fail("consents revoke", (await db.from("consents").update({ revoked_at: new Date().toISOString() }).eq("org_id", org.id).eq("user_id", memberId).eq("kind", "org_share").is("revoked_at", null)).error);
  await audit(db, { orgId: org.id, actor: user, action: "member.removed", targetUserId: memberId, details: { role } });
}

export interface AuditEntry {
  action: string;
  actorEmail: string | null;
  targetEmail: string | null;
  details: unknown;
  createdAt: string;
}

/** The org's latest actions, for owners and admins. */
export async function auditLog(db: SupabaseClient, org: OrgRef, limit = 200): Promise<AuditEntry[]> {
  requireRole(org, "members.manage");
  const { data, error } = await db
    .from("audit_logs")
    .select("action, details, created_at, actor:users!audit_logs_actor_id_fkey(email), target:users!audit_logs_target_user_id_fkey(email)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  fail("audit_logs read", error);
  return (data ?? []).map((r) => ({ action: r.action, actorEmail: emailOf(r.actor), targetEmail: emailOf(r.target), details: r.details, createdAt: r.created_at }));
}
