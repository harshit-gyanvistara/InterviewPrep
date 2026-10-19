import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { createAssignment, listAssignments, myAssignments, setMemberCohort } from "./orgCohorts";
import type { OrgRef } from "./orgInvites";
import { checkAssignment, type OrgPracticeDeps } from "./orgPractice";
import { PACKS } from "./packs";
import { nextAssignment } from "./recommend";
import type { Pack } from "./types";

// Cohorts and assignments (plans/m2-org.md O.5).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./catalog-server", async () => ({ getCatalog: async () => ({ packs: (await import("./packs")).PACKS, domains: [] }) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const COHORT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COHORT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ASSIGN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string, cohortId: string | null = null): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role, cohortId });

/** Answers selects per table (filtered by eq/in), records writes. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const filters: [string, unknown][] = [];
      const rows = () =>
        (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
      const result = () => {
        if (op === "insert") return { data: { id: "new-id" }, error: null };
        if (op !== "select") return { data: rows().length ? rows() : [], error: null };
        return { data: rows(), error: null };
      };
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        delete: () => ((op = "delete"), writes.push({ table, op }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        order: () => q,
        single: async () => result(),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok(result()),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("assignments for admins and coaches", () => {
  const body = { title: "Week 1", packId: PACKS[0].id, cohortId: null, dueAt: null, targetMockCount: 2 };

  it("lets admins set one for everyone, and audits it", async () => {
    const { db, writes } = fakeDb({});
    expect(await createAssignment(db, me, org("admin"), body)).toEqual({ id: "new-id" });
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["assignments.insert", "audit_logs.insert"]);
    expect(writes[0].payload).toMatchObject({ org_id: ORG, pack_id: PACKS[0].id, target_mock_count: 2, cohort_id: null });
  });

  it("keeps a coach in a cohort to that cohort", async () => {
    const tables = { cohorts: [{ id: COHORT_A, org_id: ORG }, { id: COHORT_B, org_id: ORG }] };
    await expect(createAssignment(fakeDb(tables).db, me, org("coach", COHORT_A), body)).rejects.toMatchObject({ status: 403 });
    await expect(createAssignment(fakeDb(tables).db, me, org("coach", COHORT_A), { ...body, cohortId: COHORT_B })).rejects.toMatchObject({ status: 403 });
    await expect(createAssignment(fakeDb(tables).db, me, org("coach", COHORT_A), { ...body, cohortId: COHORT_A })).resolves.toEqual({ id: "new-id" });
  });

  it("refuses members, unknown rounds and other orgs' cohorts", async () => {
    await expect(createAssignment(fakeDb({}).db, me, org("member"), body)).rejects.toMatchObject({ status: 403 });
    await expect(createAssignment(fakeDb({}).db, me, org("admin"), { ...body, packId: "made-up" })).rejects.toMatchObject({ status: 400 });
    await expect(createAssignment(fakeDb({ cohorts: [] }).db, me, org("admin"), { ...body, cohortId: COHORT_A })).rejects.toMatchObject({ status: 404 });
  });

  it("counts who has finished, against the right audience", async () => {
    const { db } = fakeDb({
      assignments: [
        { id: "a1", org_id: ORG, title: "All", pack_id: "p", cohort_id: null, due_at: null, target_mock_count: 2, created_at: "t" },
        { id: "a2", org_id: ORG, title: "A only", pack_id: "p", cohort_id: COHORT_A, due_at: null, target_mock_count: 1, created_at: "t" },
      ],
      memberships: [
        { org_id: ORG, status: "active", user_id: "u1", cohort_id: COHORT_A },
        { org_id: ORG, status: "active", user_id: "u2", cohort_id: COHORT_B },
        { org_id: ORG, status: "active", user_id: "u3", cohort_id: null },
      ],
      reports: [
        { assignment_id: "a1", user_id: "u1" },
        { assignment_id: "a1", user_id: "u1" },
        { assignment_id: "a1", user_id: "u2" },
        { assignment_id: "a2", user_id: "u1" },
      ],
    });
    const out = await listAssignments(db, org("admin"));
    expect(out.map((a) => [a.title, a.completedBy, a.assignedTo])).toEqual([
      ["All", 1, 3],
      ["A only", 1, 1],
    ]);
  });
});

describe("member cohorts", () => {
  it("only into this org's cohorts, and only for admins", async () => {
    const tables = { cohorts: [{ id: COHORT_A, org_id: ORG }], memberships: [{ org_id: ORG, user_id: "u1", status: "active" }] };
    await setMemberCohort(fakeDb(tables).db, me, org("admin"), "u1", COHORT_A);
    await expect(setMemberCohort(fakeDb(tables).db, me, org("admin"), "u1", COHORT_B)).rejects.toMatchObject({ status: 404 });
    await expect(setMemberCohort(fakeDb(tables).db, me, org("coach"), "u1", COHORT_A)).rejects.toMatchObject({ status: 403 });
  });
});

describe("myAssignments", () => {
  it("shows open ones for my cohort or everyone, with my progress", async () => {
    const { db } = fakeDb({
      memberships: [{ user_id: "me", status: "active", org_id: ORG, cohort_id: COHORT_A, organizations: { name: "Sunrise" } }],
      assignments: [
        { id: "a1", org_id: ORG, cohort_id: null, title: "All", pack_id: "p", due_at: "2026-11-01T00:00:00Z", target_mock_count: 2 },
        { id: "a2", org_id: ORG, cohort_id: COHORT_B, title: "Other cohort", pack_id: "p", due_at: null, target_mock_count: 1 },
        { id: "a3", org_id: ORG, cohort_id: COHORT_A, title: "Done already", pack_id: "p", due_at: null, target_mock_count: 1 },
      ],
      reports: [
        { assignment_id: "a1", user_id: "me" },
        { assignment_id: "a3", user_id: "me" },
      ],
    });
    expect(await myAssignments(db, me)).toEqual([
      { id: "a1", orgId: ORG, orgName: "Sunrise", title: "All", packId: "p", dueAt: "2026-11-01T00:00:00Z", target: 2, done: 1 },
    ]);
  });
});

describe("checkAssignment", () => {
  const pack = { id: "behavioural" } as Pack;
  const deps = (a: { org_id: string; cohort_id: string | null; pack_id: string } | null, cohortId: string | null = COHORT_A): OrgPracticeDeps => ({
    store: { membership: async () => ({ orgId: ORG, userId: "me", role: "member", status: "active", cohortId }), shareLevel: async () => undefined },
    settings: async () => ({}),
    assignment: async () => a,
  });

  it("accepts the assigned round for my cohort or everyone", async () => {
    await expect(checkAssignment(me, ORG, ASSIGN, pack, deps({ org_id: ORG, cohort_id: null, pack_id: "behavioural" }))).resolves.toBeUndefined();
    await expect(checkAssignment(me, ORG, ASSIGN, pack, deps({ org_id: ORG, cohort_id: COHORT_A, pack_id: "behavioural" }))).resolves.toBeUndefined();
  });

  it("refuses another org's, another cohort's, a different round, or a missing one", async () => {
    for (const a of [
      { org_id: "22222222-2222-2222-2222-222222222222", cohort_id: null, pack_id: "behavioural" },
      { org_id: ORG, cohort_id: COHORT_B, pack_id: "behavioural" },
      { org_id: ORG, cohort_id: null, pack_id: "coding" },
      null,
    ]) {
      await expect(checkAssignment(me, ORG, ASSIGN, pack, deps(a))).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe("nextAssignment", () => {
  it("picks the earliest due date, then ones without one", () => {
    const a = { id: "a", dueAt: null };
    const b = { id: "b", dueAt: "2026-11-05T00:00:00Z" };
    const c = { id: "c", dueAt: "2026-11-01T00:00:00Z" };
    expect(nextAssignment([a, b, c])?.id).toBe("c");
    expect(nextAssignment([a])?.id).toBe("a");
    expect(nextAssignment([])).toBeUndefined();
  });
});
