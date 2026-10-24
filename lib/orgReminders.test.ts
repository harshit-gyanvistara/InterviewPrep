import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { Mail, Mailer } from "./notify";
import { attention } from "./orgAttention";
import type { OrgRef } from "./orgInvites";
import { nudge, overdueMembers, sendDueReminders } from "./orgReminders";

// Reminders and the "needs attention" lists (plans/b2b-college.md B.10).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const DEPT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SECTION = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const OTHER = "99999999-9999-9999-9999-999999999999";
const NOW = Date.UTC(2026, 10, 10, 4, 0, 0);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const me: AuthUser = { id: "staff", email: "staff@college.edu" };
const org = (role: string, cohortId: string | null = null): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role, cohortId });

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; payload: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const tests: ((r: Record<string, unknown>) => boolean)[] = [];
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, payload: p }), q),
        eq: (k: string, v: unknown) => (tests.push((r) => r[k] === v), q),
        in: (k: string, v: unknown[]) => (tests.push((r) => v.includes(r[k])), q),
        is: () => q,
        not: () => q,
        gte: (k: string, v: string) => (tests.push((r) => String(r[k]) >= v), q),
        lte: (k: string, v: string) => (tests.push((r) => String(r[k]) <= v), q),
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => void) => ok({ data: op === "insert" ? null : (tables[table] ?? []).filter((r) => tests.every((t) => t(r))), error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const outbox = () => {
  const sent: Mail[] = [];
  const ok: Mailer = async (m) => (sent.push(m), { sent: true });
  return { sent, ok };
};

const asg = (id: string, dueInHours: number, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, cohort_id: null, group_id: null, title: `Work ${id}`, pack_id: "behavioural", due_at: iso(NOW + dueInHours * HOUR), target_mock_count: 1, gate_score: null, organizations: { name: "Sunrise" }, ...over,
});
const mem = (user_id: string, over: Record<string, unknown> = {}) => ({ org_id: ORG, user_id, status: "active", role: "member", cohort_id: null, joined_at: "t", users: { email: `${user_id}@c.edu` }, ...over });
const tree = [
  { id: DEPT, org_id: ORG, name: "CSE", parent_id: null, archived: false },
  { id: SECTION, org_id: ORG, name: "A", parent_id: DEPT, archived: false },
  { id: OTHER, org_id: ORG, name: "ECE", parent_id: null, archived: false },
];
const base = (extra: Record<string, Record<string, unknown>[]> = {}) => ({ assignments: [asg("a1", 24)], memberships: [mem("u1"), mem("u2")], cohorts: tree, reports: [], consents: [], ...extra });

describe("sendDueReminders", () => {
  it("emails each member who hasn't done work due soon, with a link to it", async () => {
    const { db, writes } = fakeDb(base());
    const box = outbox();
    const run = await sendDueReminders(db, NOW, box.ok);
    expect(run).toEqual({ sent: 2, skipped: 0, notConfigured: 0, failed: 0 });
    expect(box.sent.map((m) => m.to).sort()).toEqual(["u1@c.edu", "u2@c.edu"]);
    expect(box.sent[0].subject).toBe("Due soon: Work a1");
    expect(box.sent[0].text).toContain("/practice?pack=behavioural&assignment=a1");
    expect(writes.filter((w) => w.table === "reminder_log")).toHaveLength(2);
  });

  it("sends an overdue note a day after, and nothing for work far off or long past", async () => {
    const t = base({ assignments: [asg("late", -30), asg("far", 100), asg("ancient", -24 * 10)] });
    const box = outbox();
    await sendDueReminders(fakeDb(t).db, NOW, box.ok);
    expect(new Set(box.sent.map((m) => m.subject))).toEqual(new Set(["Overdue: Work late"]));
  });

  it("never sends the same reminder twice", async () => {
    const t = base({ reminder_log: [{ assignment_id: "a1", user_id: "u1", kind: "due_soon", sent_at: iso(NOW - HOUR) }] });
    const box = outbox();
    const run = await sendDueReminders(fakeDb(t).db, NOW, box.ok);
    expect(box.sent.map((m) => m.to)).toEqual(["u2@c.edu"]);
    expect(run).toMatchObject({ sent: 1, skipped: 1 });
  });

  it("leaves out people who finished, were excused, left, aren't members, or have no email", async () => {
    const t = base({
      memberships: [mem("done"), mem("excused"), mem("left", { status: "removed" }), mem("coach", { role: "coach" }), mem("noemail", { users: { email: null } }), mem("behind")],
      reports: [{ org_id: ORG, assignment_id: "a1", user_id: "done", data: { overall: 60, verdict: "Hire" } }],
      assignment_waivers: [{ assignment_id: "a1", user_id: "excused", reason: "Medical" }],
    });
    const box = outbox();
    const run = await sendDueReminders(fakeDb(t).db, NOW, box.ok);
    expect(box.sent.map((m) => m.to)).toEqual(["behind@c.edu"]);
    expect(run.skipped).toBe(1); // the one with no email
  });

  it("uses the real score gate for the member's own reminder", async () => {
    const t = base({
      assignments: [asg("a1", 24, { gate_score: 70 })],
      memberships: [mem("passed"), mem("below")],
      reports: [
        { org_id: ORG, assignment_id: "a1", user_id: "passed", data: { overall: 75, verdict: "Hire" } },
        { org_id: ORG, assignment_id: "a1", user_id: "below", data: { overall: 55, verdict: "Not Yet" } },
      ],
    });
    const box = outbox();
    await sendDueReminders(fakeDb(t).db, NOW, box.ok);
    expect(box.sent.map((m) => m.to)).toEqual(["below@c.edu"]);
  });

  it("reaches a section's members through the department it was set for, not other departments", async () => {
    const t = base({
      assignments: [asg("a1", 24, { cohort_id: DEPT })],
      memberships: [mem("insec", { cohort_id: SECTION }), mem("ece", { cohort_id: OTHER }), mem("none", { cohort_id: null })],
    });
    const box = outbox();
    await sendDueReminders(fakeDb(t).db, NOW, box.ok);
    expect(box.sent.map((m) => m.to)).toEqual(["insec@c.edu"]);
  });

  it("records nothing when mail isn't set up, or when sending fails", async () => {
    const off: Mailer = async () => ({ sent: false, reason: "not_configured" });
    const a = fakeDb(base());
    expect(await sendDueReminders(a.db, NOW, off)).toMatchObject({ sent: 0, notConfigured: 2 });
    expect(a.writes).toEqual([]);
    const bad: Mailer = async () => ({ sent: false, reason: "failed" });
    const b = fakeDb(base());
    expect(await sendDueReminders(b.db, NOW, bad)).toMatchObject({ sent: 0, failed: 2 });
    expect(b.writes).toEqual([]);
  });
});

describe("overdueMembers", () => {
  const consent = (user_id: string, shareLevel: string) => ({ org_id: ORG, user_id, kind: "org_share", value: { shareLevel }, granted_at: "t", revoked_at: null });

  it("lists who is behind on work that's past due, most behind first", async () => {
    const t = base({ assignments: [asg("x", -48), asg("y", -72)], memberships: [mem("u1"), mem("u2")], reports: [{ org_id: ORG, assignment_id: "x", user_id: "u2", data: { overall: 60, verdict: "Hire" } }] });
    const out = await overdueMembers(fakeDb(t).db, org("admin"), NOW);
    expect(out.map((m) => [m.userId, m.items.length])).toEqual([["u1", 2], ["u2", 1]]);
  });

  it("doesn't reveal a score through a gate for someone who shares only activity", async () => {
    const t = base({
      assignments: [asg("g", -48, { gate_score: 70 })],
      memberships: [mem("private"), mem("open")],
      consents: [consent("private", "activity"), consent("open", "scores")],
      reports: [
        { org_id: ORG, assignment_id: "g", user_id: "private", data: { overall: 20, verdict: "Not Yet" } },
        { org_id: ORG, assignment_id: "g", user_id: "open", data: { overall: 20, verdict: "Not Yet" } },
      ],
    });
    // Both scored 20, under the gate. The private member took a mock, which is all that's visible, so they're not listed.
    expect((await overdueMembers(fakeDb(t).db, org("admin"), NOW)).map((m) => m.userId)).toEqual(["open"]);
  });

  it("limits a coach to their own part of the tree", async () => {
    const t = base({ assignments: [asg("x", -48)], memberships: [mem("mine", { cohort_id: SECTION }), mem("theirs", { cohort_id: OTHER })] });
    expect((await overdueMembers(fakeDb(t).db, org("coach", DEPT), NOW)).map((m) => m.userId)).toEqual(["mine"]);
    await expect(overdueMembers(fakeDb(t).db, org("member"), NOW)).rejects.toMatchObject({ status: 403 });
  });
});

describe("attention", () => {
  it("lists members whose readiness is under 50, lowest first, only when they share scores", async () => {
    const report = (user_id: string, overall: number) => ({ org_id: ORG, assignment_id: null, user_id, data: { sessionId: user_id, createdAt: NOW - HOUR, packId: "p", overall, verdict: "Not Yet", dimensions: [{ name: "x", score: 3, assessed: true }], signals: {} } });
    const t = base({
      assignments: [],
      memberships: [mem("weak"), mem("weaker"), mem("fine"), mem("hidden"), mem("staff2", { role: "coach" })],
      consents: [{ org_id: ORG, user_id: "weak", kind: "org_share", value: { shareLevel: "scores" }, granted_at: "t", revoked_at: null }, { org_id: ORG, user_id: "weaker", kind: "org_share", value: { shareLevel: "full" }, granted_at: "t", revoked_at: null }, { org_id: ORG, user_id: "fine", kind: "org_share", value: { shareLevel: "scores" }, granted_at: "t", revoked_at: null }, { org_id: ORG, user_id: "hidden", kind: "org_share", value: { shareLevel: "activity" }, granted_at: "t", revoked_at: null }],
      reports: [report("weak", 45), report("weaker", 30), report("fine", 80), report("hidden", 10)],
    });
    const out = await attention(fakeDb(t).db, org("admin"), NOW);
    expect(out.atRisk.map((m) => [m.userId, m.readiness])).toEqual([["weaker", 30], ["weak", 45]]);
    expect(out.threshold).toBe(50);
  });
});

describe("nudge", () => {
  const behind = () => base({ assignments: [asg("x", -48)], memberships: [mem("u1", { cohort_id: SECTION }), mem("u2", { cohort_id: OTHER })] });

  it("emails people who are behind and records it", async () => {
    const { db, writes } = fakeDb(behind());
    const box = outbox();
    const out = await nudge(db, me, org("admin"), [{ userId: "u1", assignmentId: "x" }], NOW, box.ok);
    expect(out).toMatchObject({ sent: 1, tooSoon: 0, notApplicable: 0 });
    expect(box.sent[0].subject).toContain("A reminder from Sunrise");
    expect(writes.find((w) => w.table === "reminder_log")!.payload).toMatchObject({ user_id: "u1", assignment_id: "x", kind: "nudge", sent_by: "staff" });
    expect(writes.some((w) => w.table === "audit_logs")).toBe(true);
  });

  it("allows one a day per person per assignment", async () => {
    const t = { ...behind(), reminder_log: [{ assignment_id: "x", user_id: "u1", kind: "nudge", sent_at: iso(NOW - 2 * HOUR) }] };
    const box = outbox();
    const out = await nudge(fakeDb(t).db, me, org("admin"), [{ userId: "u1", assignmentId: "x" }], NOW, box.ok);
    expect(out).toMatchObject({ sent: 0, tooSoon: 1 });
    expect(box.sent).toEqual([]);
  });

  it("only reaches people who are actually behind and in the caller's view", async () => {
    const box = outbox();
    const out = await nudge(fakeDb(behind()).db, me, org("coach", DEPT), [{ userId: "u2", assignmentId: "x" }, { userId: "ghost", assignmentId: "x" }, { userId: "u1", assignmentId: "nope" }], NOW, box.ok);
    expect(out).toMatchObject({ sent: 0, notApplicable: 3 });
    expect(box.sent).toEqual([]);
  });

  it("says when mail isn't set up, and records nothing", async () => {
    const { db, writes } = fakeDb(behind());
    const out = await nudge(db, me, org("admin"), [{ userId: "u1", assignmentId: "x" }], NOW, async () => ({ sent: false, reason: "not_configured" }));
    expect(out).toMatchObject({ sent: 0, notConfigured: true });
    expect(writes).toEqual([]);
  });

  it("is for people who set work, with a sensible number of targets", async () => {
    await expect(nudge(fakeDb(behind()).db, me, org("member"), [{ userId: "u1", assignmentId: "x" }], NOW, outbox().ok)).rejects.toMatchObject({ status: 403 });
    await expect(nudge(fakeDb(behind()).db, me, org("admin"), [], NOW, outbox().ok)).rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: 51 }, (_, i) => ({ userId: `u${i}`, assignmentId: "x" }));
    await expect(nudge(fakeDb(behind()).db, me, org("admin"), many, NOW, outbox().ok)).rejects.toMatchObject({ status: 400 });
  });
});
