import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { memberDetail, removeMember, updateMember } from "./orgDashboard";
import type { OrgRef } from "./orgInvites";

// Roles, removal and member detail for org admins (plans/m2-org.md O.6).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./catalog-server", () => ({ getCatalog: async () => ({ packs: [], domains: [] }) }));

const ORG = "org-1";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string, cohortId: string | null = null): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role, cohortId });

/** Selects filter rows by eq/in/is; writes are recorded. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let head = false;
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : v === null ? r[k] == null : r[k] === v)));
      const result = () => (head ? { count: rows().length, error: null } : { data: op === "select" ? rows() : [{}], error: null });
      const q = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        is: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok(result()),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const memberships = (rows: [string, string, string?][]) => rows.map(([user_id, role, cohort_id]) => ({ org_id: ORG, user_id, role, status: "active", cohort_id: cohort_id ?? null, joined_at: "t", users: { email: `${user_id}@college.edu` } }));

describe("updateMember roles", () => {
  it("lets admins change member and coach roles", async () => {
    const { db, writes } = fakeDb({ memberships: memberships([["u1", "member"]]) });
    await updateMember(db, me, org("admin"), "u1", { role: "coach" });
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["memberships.update", "audit_logs.insert"]);
    expect(writes[0].payload).toEqual({ role: "coach" });
  });

  it("keeps owner changes to owners, and never demotes the last owner", async () => {
    await expect(updateMember(fakeDb({ memberships: memberships([["u1", "member"]]) }).db, me, org("admin"), "u1", { role: "owner" })).rejects.toMatchObject({ status: 403 });
    await expect(updateMember(fakeDb({ memberships: memberships([["u1", "owner"]]) }).db, me, org("admin"), "u1", { role: "member" })).rejects.toMatchObject({ status: 403 });
    await expect(updateMember(fakeDb({ memberships: memberships([["u1", "owner"]]) }).db, me, org("owner"), "u1", { role: "member" })).rejects.toMatchObject({ status: 409 });
    await expect(updateMember(fakeDb({ memberships: memberships([["u1", "owner"], ["u2", "owner"]]) }).db, me, org("owner"), "u1", { role: "member" })).resolves.toBeUndefined();
  });

  it("refuses coaches and members", async () => {
    await expect(updateMember(fakeDb({ memberships: memberships([["u1", "member"]]) }).db, me, org("coach"), "u1", { role: "admin" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("removeMember", () => {
  it("removes, revokes sharing and audits", async () => {
    const { db, writes } = fakeDb({ memberships: memberships([["u1", "member"]]) });
    await removeMember(db, me, org("admin"), "u1");
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["memberships.update", "consents.update", "audit_logs.insert"]);
    expect(writes[0].payload).toEqual({ status: "removed" });
  });

  it("guards self, owners and the last owner", async () => {
    await expect(removeMember(fakeDb({}).db, me, org("admin"), "me")).rejects.toMatchObject({ status: 400 });
    await expect(removeMember(fakeDb({ memberships: memberships([["u1", "owner"], ["u2", "owner"]]) }).db, me, org("admin"), "u1")).rejects.toMatchObject({ status: 403 });
    await expect(removeMember(fakeDb({ memberships: memberships([["u1", "owner"]]) }).db, me, org("owner"), "u1")).rejects.toMatchObject({ status: 409 });
    await expect(removeMember(fakeDb({ memberships: memberships([["u1", "member"]]) }).db, me, org("member"), "u1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("memberDetail", () => {
  const reportRow = (user_id: string, sessionId: string) => ({ org_id: ORG, user_id, data: { sessionId, createdAt: 1, packId: "behavioural", overall: 70, verdict: "Hire", dimensions: [] } });
  const tables = (share: string) => ({
    memberships: memberships([["u1", "member", "c1"], ["u2", "member", "c2"]]),
    consents: [{ org_id: ORG, user_id: "u1", kind: "org_share", revoked_at: null, value: { shareLevel: share } }],
    reports: [reportRow("u1", "s1"), reportRow("u2", "s2")],
    sessions: [{ org_id: ORG, user_id: "u1", id: "s1", data: { messages: [{ id: "m", role: "candidate", text: "Hello", at: 0 }] } }],
    cohorts: [],
  });

  it("shows transcripts only when the member shares everything, and audits the view", async () => {
    const full = fakeDb(tables("full"));
    const out = await memberDetail(full.db, me, org("admin"), "u1");
    expect(out.transcripts).toEqual([{ sessionId: "s1", messages: [{ role: "candidate", text: "Hello" }] }]);
    expect(full.writes).toEqual([expect.objectContaining({ table: "audit_logs", payload: expect.objectContaining({ action: "member.viewed", target_user_id: "u1" }) })]);

    const scores = await memberDetail(fakeDb(tables("scores")).db, me, org("admin"), "u1");
    expect(scores.transcripts).toBeNull();
    expect(scores.reports[0]).toMatchObject({ overall: 70 });

    const activity = await memberDetail(fakeDb(tables("activity")).db, me, org("admin"), "u1");
    expect(activity.reports[0]).not.toHaveProperty("overall");
  });

  it("logs a repeat view within a minute only once", async () => {
    const t = { ...tables("scores"), audit_logs: [{ org_id: ORG, actor_id: "me", target_user_id: "u1", action: "member.viewed" }] };
    const { db, writes } = fakeDb(t);
    await memberDetail(db, me, org("admin"), "u1");
    expect(writes).toEqual([]);
  });

  it("keeps a coach to their own cohort, and members out", async () => {
    await expect(memberDetail(fakeDb(tables("full")).db, me, org("coach", "c2"), "u1")).rejects.toMatchObject({ status: 404 });
    await expect(memberDetail(fakeDb(tables("full")).db, me, org("coach", "c1"), "u1")).resolves.toBeDefined();
    await expect(memberDetail(fakeDb(tables("full")).db, me, org("member"), "u1")).rejects.toMatchObject({ status: 403 });
  });
});
