import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { ASSIGNEE_ROLE, cohortNodes, countsFrom, reportRows, waivedKey, waivers } from "./orgCohorts";
import { loadOrg, type OrgData } from "./orgDashboard";
import { requireRole, type OrgRef } from "./orgInvites";
import { inScope, type CohortNode } from "./orgSections";
import { appUrl, type Mailer } from "./notify";
import { shareAllows, type ShareLevel } from "./permissions";
import { canNudge, kindFor, reminderMail, type ReminderKind } from "./reminders";

// Server-only. Work that is due and not done, who is behind on it, and the reminders about it
// (plans/b2b-college.md B.10). Reminders go to members only, once per kind per person per assignment,
// and never to someone who has left. A staff nudge is limited to once a day per person per assignment.

export interface PendingItem {
  orgId: string;
  orgName: string;
  assignmentId: string;
  packId: string;
  title: string;
  dueAt: number;
  userId: string;
  email: string | null;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

/**
 * Due work that active members haven't finished or been excused from. `orgIds` limits which orgs
 * (null = all, for the scheduled run); `dueBetween` limits by due date. `levels` makes it follow
 * sharing: for a member who shares less than scores, a score gate is ignored (a mock taken counts), so
 * the answer never reveals whether they cleared it. Without it (reminders to the member themselves)
 * the real gate applies.
 */
export async function pendingWork(
  db: SupabaseClient,
  opts: { orgIds: string[] | null; dueBetween: [number, number]; levels?: Map<string, ShareLevel> },
): Promise<PendingItem[]> {
  let q = db
    .from("assignments")
    .select("id, org_id, cohort_id, group_id, title, pack_id, due_at, target_mock_count, gate_score, organizations(name)")
    .not("due_at", "is", null)
    .gte("due_at", new Date(opts.dueBetween[0]).toISOString())
    .lte("due_at", new Date(opts.dueBetween[1]).toISOString());
  if (opts.orgIds) q = q.in("org_id", opts.orgIds);
  const { data: assignments, error } = await q;
  fail("assignments read", error);
  if (!assignments?.length) return [];

  const orgIds = [...new Set(assignments.map((a) => a.org_id as string))];
  const ids = assignments.map((a) => a.id as string);
  const [members, groupRows, mocks, excused, nodeLists] = await Promise.all([
    db.from("memberships").select("org_id, user_id, cohort_id, users(email)").eq("role", ASSIGNEE_ROLE).eq("status", "active").in("org_id", orgIds),
    db.from("group_members").select("group_id, user_id").in("org_id", orgIds),
    reportRows(db, ids),
    waivers(db, ids),
    Promise.all(orgIds.map(async (id) => [id, await cohortNodes(db, id)] as const)),
  ]);
  fail("memberships read", members.error);
  fail("group_members read", groupRows.error);
  const nodes = new Map<string, CohortNode[]>(nodeLists);
  const inGroup = new Set((groupRows.data ?? []).map((g) => `${g.group_id}:${g.user_id}`));
  const gated = countsFrom(mocks, assignments);
  const ungated = countsFrom(mocks, assignments.map((a) => ({ id: a.id, gate_score: null })));

  const out: PendingItem[] = [];
  for (const a of assignments) {
    const orgName = ((a.organizations as unknown as { name: string } | null)?.name) ?? "";
    for (const m of members.data ?? []) {
      if (m.org_id !== a.org_id) continue;
      const audience = a.group_id ? inGroup.has(`${a.group_id}:${m.user_id}`) : inScope(nodes.get(a.org_id) ?? [], m.cohort_id ?? null, a.cohort_id ?? null);
      if (!audience || excused.has(waivedKey(a.id, m.user_id))) continue;
      const level = opts.levels?.get(m.user_id);
      const counts = opts.levels && !(level && shareAllows(level, "scores")) ? ungated : gated;
      if ((counts.get(a.id)?.get(m.user_id) ?? 0) >= a.target_mock_count) continue;
      const u = m.users as unknown as { email: string | null } | null;
      out.push({ orgId: a.org_id, orgName, assignmentId: a.id, packId: a.pack_id, title: a.title, dueAt: Date.parse(a.due_at), userId: m.user_id, email: u?.email ?? null });
    }
  }
  return out;
}

const linkFor = (i: PendingItem) => `${appUrl()}/practice?pack=${encodeURIComponent(i.packId)}&assignment=${i.assignmentId}`;

async function lastSent(db: SupabaseClient, items: PendingItem[], kind: ReminderKind): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!items.length) return out;
  const { data, error } = await db
    .from("reminder_log")
    .select("assignment_id, user_id, sent_at")
    .eq("kind", kind)
    .in("assignment_id", [...new Set(items.map((i) => i.assignmentId))])
    .order("sent_at", { ascending: false });
  fail("reminder_log read", error);
  for (const r of data ?? []) {
    const key = waivedKey(r.assignment_id, r.user_id);
    if (!out.has(key)) out.set(key, Date.parse(r.sent_at));
  }
  return out;
}

export interface ReminderRun {
  sent: number;
  /** Already reminded about this, or no email address. */
  skipped: number;
  /** Mail isn't configured, so nothing was sent and nothing was recorded. */
  notConfigured: number;
  failed: number;
}

/** The scheduled run: due-soon and overdue reminders for every org, each at most once. */
export async function sendDueReminders(db: SupabaseClient, now: number, mailer: Mailer): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, skipped: 0, notConfigured: 0, failed: 0 };
  const items = await pendingWork(db, { orgIds: null, dueBetween: [now - 7 * 86_400_000, now + 2 * 86_400_000] });
  const wanted = items.flatMap((i) => {
    const kind = kindFor(i.dueAt, now);
    return kind ? [{ item: i, kind }] : [];
  });
  const [soon, over] = await Promise.all([lastSent(db, wanted.filter((w) => w.kind === "due_soon").map((w) => w.item), "due_soon"), lastSent(db, wanted.filter((w) => w.kind === "overdue").map((w) => w.item), "overdue")]);
  const logged = (kind: ReminderKind) => (kind === "due_soon" ? soon : over);

  for (const { item, kind } of wanted) {
    if (!item.email || logged(kind).has(waivedKey(item.assignmentId, item.userId))) {
      run.skipped++;
      continue;
    }
    const result = await mailer({ to: item.email, ...reminderMail(kind, { orgName: item.orgName, title: item.title, dueAt: item.dueAt, link: linkFor(item) }) });
    if (!result.sent) {
      if (result.reason === "not_configured") run.notConfigured++;
      else run.failed++;
      continue;
    }
    fail("reminder_log insert", (await db.from("reminder_log").insert({ org_id: item.orgId, assignment_id: item.assignmentId, user_id: item.userId, kind })).error);
    run.sent++;
  }
  return run;
}

export interface OverdueMember {
  userId: string;
  email: string | null;
  items: { assignmentId: string; title: string; dueAt: number }[];
}

/** Members in the caller's view who are behind on due work, following each member's sharing choice. */
export async function overdueMembers(db: SupabaseClient, org: OrgRef, now: number, loaded?: OrgData): Promise<OverdueMember[]> {
  requireRole(org, "analytics.view");
  const data = loaded ?? (await loadOrg(db, org));
  const levels = new Map(data.members.map((m) => [m.userId, m.shareLevel]));
  const visible = new Set(data.members.filter((m) => m.role === ASSIGNEE_ROLE).map((m) => m.userId));
  const items = (await pendingWork(db, { orgIds: [org.id], dueBetween: [0, now], levels })).filter((i) => visible.has(i.userId));
  const by = new Map<string, OverdueMember>();
  for (const i of items) {
    const m = by.get(i.userId) ?? { userId: i.userId, email: i.email, items: [] };
    m.items.push({ assignmentId: i.assignmentId, title: i.title, dueAt: i.dueAt });
    by.set(i.userId, m);
  }
  return [...by.values()].sort((a, b) => b.items.length - a.items.length).slice(0, 50);
}

export interface NudgeResult {
  sent: number;
  /** Nudged in the last day already. */
  tooSoon: number;
  /** Not a member in your view, no longer behind on it, or no email. */
  notApplicable: number;
  notConfigured: boolean;
}

export const MAX_NUDGES = 50;

/** A staff member's one-click reminder to people who are behind. At most once a day per person per assignment. */
export async function nudge(db: SupabaseClient, actor: AuthUser, org: OrgRef, targets: { userId: string; assignmentId: string }[], now: number, mailer: Mailer): Promise<NudgeResult> {
  requireRole(org, "assignments.create");
  if (!targets.length || targets.length > MAX_NUDGES) throw new ApiError(400, `Pick between 1 and ${MAX_NUDGES} reminders to send.`);
  const data = await loadOrg(db, org);
  const levels = new Map(data.members.map((m) => [m.userId, m.shareLevel]));
  const visible = new Set(data.members.filter((m) => m.role === ASSIGNEE_ROLE).map((m) => m.userId));
  const behind = (await pendingWork(db, { orgIds: [org.id], dueBetween: [0, now], levels })).filter((i) => visible.has(i.userId));
  const pending = new Map(behind.map((i) => [waivedKey(i.assignmentId, i.userId), i]));
  const lastNudge = await lastSent(db, behind, "nudge");

  const out: NudgeResult = { sent: 0, tooSoon: 0, notApplicable: 0, notConfigured: false };
  for (const t of targets) {
    const key = waivedKey(t.assignmentId, t.userId);
    const item = pending.get(key);
    if (!item || !item.email) {
      out.notApplicable++;
      continue;
    }
    if (!canNudge(lastNudge.get(key) ?? null, now)) {
      out.tooSoon++;
      continue;
    }
    const result = await mailer({ to: item.email, ...reminderMail("nudge", { orgName: org.name, title: item.title, dueAt: item.dueAt, link: linkFor(item) }) });
    if (!result.sent) {
      if (result.reason === "not_configured") out.notConfigured = true;
      else out.notApplicable++;
      continue;
    }
    fail("reminder_log insert", (await db.from("reminder_log").insert({ org_id: org.id, assignment_id: t.assignmentId, user_id: t.userId, kind: "nudge", sent_by: actor.id })).error);
    out.sent++;
  }
  if (out.sent) await audit(db, { orgId: org.id, actor, action: "reminder.nudged", details: { count: out.sent } });
  return out;
}

