import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { OrgRef } from "./orgInvites";
import { memberPlans, unwaiveStage, waiveStage } from "./orgWaivers";

// Waivers and the member plan staff see (plans/b2b-college.md B.9).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const A1 = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const DEPT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OTHER = "99999999-9999-9999-9999-999999999999";
const me: AuthUser = { id: "me", email: "coach@college.edu" };
const org = (role: string, cohortId: string | null = null): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role, cohortId });

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        upsert: (p: unknown) => ((op = "upsert"), writes.push({ table, op, payload: p }), q),
        delete: () => ((op = "delete"), writes.push({ table, op }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        is: () => q,
        order: () => q,
        gte: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: op === "select" || op === "delete" ? rows() : null, error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const base = (level: string, cohort: string | null = DEPT) => ({
  memberships: [
    { org_id: ORG, status: "active", user_id: "u1", role: "member", cohort_id: cohort, joined_at: "t", users: { email: "u1@c.edu" } },
    { org_id: ORG, status: "active", user_id: "staff", role: "coach", cohort_id: null, joined_at: "t", users: { email: "s@c.edu" } },
  ],
  consents: [{ org_id: ORG, user_id: "u1", kind: "org_share", value: { shareLevel: level }, granted_at: "t", revoked_at: null }],
  cohorts: [{ id: DEPT, org_id: ORG, name: "CSE", parent_id: null, archived: false }, { id: OTHER, org_id: ORG, name: "ECE", parent_id: null, archived: false }],
  reports: [],
  assignments: [{ id: A1, org_id: ORG }],
});

describe("waiveStage", () => {
  it("excuses a member with a reason and audits it", async () => {
    const { db, writes } = fakeDb(base("scores"));
    await waiveStage(db, me, org("coach"), "u1", A1, "  Medical leave  ");
    expect(writes[0]).toMatchObject({ table: "assignment_waivers", op: "upsert", payload: { assignment_id: A1, user_id: "u1", org_id: ORG, reason: "Medical leave", waived_by: "me" } });
    expect(writes.at(-1)).toMatchObject({ table: "audit_logs" });
  });

  it("needs a real reason", async () => {
    for (const reason of ["", "  ", "ok", "x".repeat(301)]) {
      await expect(waiveStage(fakeDb(base("scores")).db, me, org("coach"), "u1", A1, reason)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("is for coaches and above, and a coach stays within their own section", async () => {
    await expect(waiveStage(fakeDb(base("scores")).db, me, org("member"), "u1", A1, "Medical leave")).rejects.toMatchObject({ status: 403 });
    await expect(waiveStage(fakeDb(base("scores")).db, me, org("coach", OTHER), "u1", A1, "Medical leave")).rejects.toMatchObject({ status: 404 });
    await expect(waiveStage(fakeDb(base("scores")).db, me, org("coach", DEPT), "u1", A1, "Medical leave")).resolves.toBeUndefined();
  });

  it("404s a staff member, an unknown member, and an assignment from another org", async () => {
    await expect(waiveStage(fakeDb(base("scores")).db, me, org("admin"), "staff", A1, "Medical leave")).rejects.toMatchObject({ status: 404 });
    await expect(waiveStage(fakeDb(base("scores")).db, me, org("admin"), "nobody", A1, "Medical leave")).rejects.toMatchObject({ status: 404 });
    await expect(waiveStage(fakeDb({ ...base("scores"), assignments: [{ id: A1, org_id: "other" }] }).db, me, org("admin"), "u1", A1, "Medical leave")).rejects.toMatchObject({ status: 404 });
  });
});

describe("unwaiveStage", () => {
  it("removes a waiver and audits it, and 404s one that isn't there", async () => {
    const { db, writes } = fakeDb({ ...base("scores"), assignment_waivers: [{ assignment_id: A1, user_id: "u1", org_id: ORG }] });
    await unwaiveStage(db, me, org("admin"), "u1", A1);
    expect(writes.some((w) => w.table === "assignment_waivers" && w.op === "delete")).toBe(true);
    await expect(unwaiveStage(fakeDb(base("scores")).db, me, org("admin"), "u1", A1)).rejects.toMatchObject({ status: 404 });
  });
});

describe("memberPlans", () => {
  it("withholds progress for a member who shares less than scores, since gates come from scores", async () => {
    expect(await memberPlans(fakeDb(base("activity")).db, org("coach"), "u1")).toEqual({ hidden: true, plans: [] });
  });

  it("returns no plans (and isn't hidden) for a member who shares scores but has none", async () => {
    expect(await memberPlans(fakeDb(base("scores")).db, org("coach"), "u1")).toEqual({ hidden: false, plans: [] });
  });

  it("is for people who can view reports", async () => {
    await expect(memberPlans(fakeDb(base("scores")).db, org("member"), "u1")).rejects.toMatchObject({ status: 403 });
  });
});
