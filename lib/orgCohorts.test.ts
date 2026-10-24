import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { createAssignment, createCohort, createGroup, listAssignments, listCohorts, myAssignments, setMemberCohort, updateCohort, updateGroup } from "./orgCohorts";
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
  const body = { title: "Week 1", packId: PACKS[0].id, cohortId: null, groupId: null, dueAt: null, targetMockCount: 2 };

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

  it("accepts one of the org's own rounds, but not an archived one or another org's", async () => {
    const mine = { ...body, packId: "org-1" };
    const tables = { org_packs: [{ id: "org-1", org_id: ORG, archived: false }, { id: "org-2", org_id: ORG, archived: true }, { id: "org-3", org_id: "other", archived: false }] };
    await expect(createAssignment(fakeDb(tables).db, me, org("admin"), mine)).resolves.toBeDefined();
    await expect(createAssignment(fakeDb(tables).db, me, org("admin"), { ...mine, packId: "org-2" })).rejects.toMatchObject({ status: 400 });
    await expect(createAssignment(fakeDb(tables).db, me, org("admin"), { ...mine, packId: "org-3" })).rejects.toMatchObject({ status: 400 });
  });

  it("counts who has finished, against the right audience", async () => {
    const { db } = fakeDb({
      assignments: [
        { id: "a1", org_id: ORG, title: "All", pack_id: "p", cohort_id: null, due_at: null, target_mock_count: 2, created_at: "t" },
        { id: "a2", org_id: ORG, title: "A only", pack_id: "p", cohort_id: COHORT_A, due_at: null, target_mock_count: 1, created_at: "t" },
      ],
      memberships: [
        { org_id: ORG, status: "active", user_id: "u1", cohort_id: COHORT_A, role: "member" },
        { org_id: ORG, status: "active", user_id: "u2", cohort_id: COHORT_B, role: "member" },
        { org_id: ORG, status: "active", user_id: "u3", cohort_id: null, role: "member" },
        // Staff set the work; they aren't counted in it.
        { org_id: ORG, status: "active", user_id: "coach", cohort_id: COHORT_A, role: "coach" },
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
  it("are for members only: staff get none", async () => {
    const { db } = fakeDb({
      memberships: [{ user_id: "me", status: "active", role: "owner", org_id: ORG, cohort_id: null, organizations: { name: "Sunrise" } }],
      assignments: [{ id: "a1", org_id: ORG, cohort_id: null, title: "All", pack_id: "p", due_at: null, target_mock_count: 1 }],
    });
    expect(await myAssignments(db, me)).toEqual([]);
  });

  it("shows open ones for my cohort or everyone, with my progress", async () => {
    const { db } = fakeDb({
      memberships: [{ user_id: "me", status: "active", role: "member", org_id: ORG, cohort_id: COHORT_A, organizations: { name: "Sunrise" } }],
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
      { id: "a1", orgId: ORG, orgName: "Sunrise", title: "All", packId: "p", dueAt: "2026-11-01T00:00:00Z", target: 2, done: 1, gateScore: null },
    ]);
  });
});

const deps = (a: { org_id: string; cohort_id: string | null; group_id?: string | null; pack_id: string } | null, cohortId: string | null = COHORT_A, extra: Partial<OrgPracticeDeps> = {}): OrgPracticeDeps => ({
  store: { membership: async () => ({ orgId: ORG, userId: "me", role: "member", status: "active", cohortId }), shareLevel: async () => undefined },
  settings: async () => ({}),
  assignment: async () => (a ? { group_id: null, ...a } : null),
  cohorts: async () => [],
  inGroup: async () => false,
  ...extra,
});
describe("checkAssignment", () => {
  const pack = { id: "behavioural" } as Pack;
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

// ---- sections and groups (plans/b2b-college.md B.2) ----

const DEPT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const YEAR = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const SECTION = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const OTHER_DEPT = "99999999-9999-9999-9999-999999999999";
const GROUP = "12121212-1212-1212-1212-121212121212";
const treeRows = [
  { id: DEPT, org_id: ORG, name: "CSE", parent_id: null, archived: false },
  { id: YEAR, org_id: ORG, name: "2027", parent_id: DEPT, archived: false },
  { id: SECTION, org_id: ORG, name: "A", parent_id: YEAR, archived: false },
  { id: OTHER_DEPT, org_id: ORG, name: "ECE", parent_id: null, archived: false },
];
const nodes = treeRows.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }));

describe("cohort tree", () => {
  it("lists cohorts in tree order with paths and roll-up counts", async () => {
    const { db } = fakeDb({
      cohorts: [treeRows[3], treeRows[2], treeRows[1], treeRows[0]],
      memberships: [
        { org_id: ORG, status: "active", user_id: "u1", cohort_id: SECTION },
        { org_id: ORG, status: "active", user_id: "u2", cohort_id: SECTION },
        { org_id: ORG, status: "active", user_id: "u3", cohort_id: DEPT },
      ],
    });
    const out = await listCohorts(db, org("admin"));
    expect(out.map((c) => c.path)).toEqual(["ECE", "CSE", "CSE / 2027", "CSE / 2027 / A"]);
    const cse = out.find((c) => c.id === DEPT)!;
    expect([cse.members, cse.membersTotal]).toEqual([1, 3]);
    expect(out.find((c) => c.id === SECTION)).toMatchObject({ path: "CSE / 2027 / A", members: 2, membersTotal: 2 });
  });

  it("creates a section under a parent and refuses bad parents and depth", async () => {
    const { db, writes } = fakeDb({ cohorts: treeRows });
    await createCohort(db, me, org("admin"), "B", YEAR);
    expect(writes[0].payload).toMatchObject({ name: "B", parent_id: YEAR });
    await expect(createCohort(fakeDb({ cohorts: treeRows }).db, me, org("admin"), "x", SECTION)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/3 levels/) });
    await expect(createCohort(fakeDb({ cohorts: treeRows }).db, me, org("admin"), "x", "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 400 });
    await expect(createCohort(fakeDb({ cohorts: treeRows }).db, me, org("coach"), "x", null)).rejects.toMatchObject({ status: 403 });
  });

  it("moves a section but never into itself or below", async () => {
    await expect(updateCohort(fakeDb({ cohorts: treeRows }).db, me, org("admin"), DEPT, { parentId: SECTION })).rejects.toMatchObject({ status: 400 });
    const { db, writes } = fakeDb({ cohorts: treeRows });
    await updateCohort(db, me, org("admin"), YEAR, { parentId: OTHER_DEPT });
    expect(writes[0].payload).toEqual({ parent_id: OTHER_DEPT });
    await expect(updateCohort(fakeDb({ cohorts: treeRows }).db, me, org("admin"), "00000000-0000-0000-0000-000000000000", { parentId: null })).rejects.toMatchObject({ status: 404 });
  });

  it("an assignment for a department covers its sections, and a coach may assign below their own cohort", async () => {
    const body = { title: "t", packId: PACKS[0].id, cohortId: SECTION, groupId: null, dueAt: null, targetMockCount: 1 };
    await expect(createAssignment(fakeDb({ cohorts: treeRows }).db, me, org("coach", DEPT), body)).resolves.toBeDefined();
    await expect(createAssignment(fakeDb({ cohorts: treeRows }).db, me, org("coach", YEAR), { ...body, cohortId: OTHER_DEPT })).rejects.toMatchObject({ status: 403 });
    await expect(createAssignment(fakeDb({ cohorts: treeRows }).db, me, org("coach", SECTION), { ...body, cohortId: YEAR })).rejects.toMatchObject({ status: 403 });

    const { db } = fakeDb({
      cohorts: treeRows,
      assignments: [{ id: "a1", org_id: ORG, title: "CSE", pack_id: "p", cohort_id: DEPT, group_id: null, due_at: null, target_mock_count: 1, created_at: "t" }],
      memberships: [
        { org_id: ORG, status: "active", user_id: "u1", cohort_id: SECTION, role: "member" },
        { org_id: ORG, status: "active", user_id: "u2", cohort_id: OTHER_DEPT, role: "member" },
        { org_id: ORG, status: "active", user_id: "u3", cohort_id: null, role: "member" },
      ],
    });
    expect((await listAssignments(db, org("admin")))[0]).toMatchObject({ assignedTo: 1 });
  });

  it("shows a member the work set for a department above their section", async () => {
    const { db } = fakeDb({
      cohorts: treeRows,
      memberships: [{ user_id: "me", status: "active", role: "member", org_id: ORG, cohort_id: SECTION, organizations: { name: "Sunrise" } }],
      assignments: [
        { id: "a1", org_id: ORG, cohort_id: DEPT, group_id: null, title: "CSE work", pack_id: "p", due_at: null, target_mock_count: 1 },
        { id: "a2", org_id: ORG, cohort_id: OTHER_DEPT, group_id: null, title: "ECE work", pack_id: "p", due_at: null, target_mock_count: 1 },
      ],
    });
    expect((await myAssignments(db, me)).map((a) => a.title)).toEqual(["CSE work"]);
  });

  it("checkAssignment accepts a department assignment for a section inside it", async () => {
    const pack = { id: "behavioural" } as Pack;
    const mk = (cohort_id: string) => deps({ org_id: ORG, cohort_id, pack_id: "behavioural" }, SECTION, { cohorts: async () => nodes });
    await expect(checkAssignment(me, ORG, ASSIGN, pack, mk(DEPT))).resolves.toBeUndefined();
    await expect(checkAssignment(me, ORG, ASSIGN, pack, mk(OTHER_DEPT))).rejects.toMatchObject({ status: 403 });
  });
});

describe("groups", () => {
  it("creates a group with only active members of this org", async () => {
    const { db, writes } = fakeDb({ memberships: [{ org_id: ORG, status: "active", user_id: "u1" }, { org_id: ORG, status: "removed", user_id: "u2" }] });
    await createGroup(db, me, org("admin"), "Amazon drive", ["u1", "u2", "stranger"]);
    const added = writes.find((w) => w.table === "group_members" && w.op === "insert")!.payload as { user_id: string }[];
    expect(added.map((r) => r.user_id)).toEqual(["u1"]);
    await expect(createGroup(fakeDb({}).db, me, org("coach"), "x", [])).rejects.toMatchObject({ status: 403 });
  });

  it("replaces the member list by adding and removing only the difference", async () => {
    const { db, writes } = fakeDb({
      groups: [{ id: GROUP, org_id: ORG }],
      memberships: [{ org_id: ORG, status: "active", user_id: "u1" }, { org_id: ORG, status: "active", user_id: "u3" }],
      group_members: [{ group_id: GROUP, user_id: "u1" }, { group_id: GROUP, user_id: "u2" }],
    });
    await updateGroup(db, me, org("admin"), GROUP, { memberIds: ["u1", "u3"] });
    expect(writes.find((w) => w.op === "insert" && w.table === "group_members")!.payload).toEqual([{ group_id: GROUP, user_id: "u3", org_id: ORG }]);
    expect(writes.some((w) => w.op === "delete" && w.table === "group_members")).toBe(true);
    await expect(updateGroup(fakeDb({ groups: [] }).db, me, org("admin"), GROUP, { name: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("assigns to a group: only its members count, admins only, never alongside a cohort", async () => {
    const body = { title: "t", packId: PACKS[0].id, cohortId: null, groupId: GROUP, dueAt: null, targetMockCount: 1 };
    await expect(createAssignment(fakeDb({ groups: [{ id: GROUP, org_id: ORG, archived: false }] }).db, me, org("admin"), body)).resolves.toBeDefined();
    await expect(createAssignment(fakeDb({ groups: [] }).db, me, org("admin"), body)).rejects.toMatchObject({ status: 404 });
    await expect(createAssignment(fakeDb({ groups: [{ id: GROUP, org_id: ORG, archived: false }] }).db, me, org("coach"), body)).rejects.toMatchObject({ status: 403 });

    const { db } = fakeDb({
      assignments: [{ id: "a1", org_id: ORG, title: "Drive", pack_id: "p", cohort_id: null, group_id: GROUP, due_at: null, target_mock_count: 1, created_at: "t" }],
      memberships: [
        { org_id: ORG, status: "active", user_id: "u1", cohort_id: null, role: "member" },
        { org_id: ORG, status: "active", user_id: "u2", cohort_id: null, role: "member" },
      ],
      group_members: [{ group_id: GROUP, user_id: "u1", org_id: ORG }],
    });
    expect((await listAssignments(db, org("admin")))[0]).toMatchObject({ groupId: GROUP, assignedTo: 1 });

    const mine = fakeDb({
      memberships: [{ user_id: "me", status: "active", role: "member", org_id: ORG, cohort_id: null, organizations: { name: "Sunrise" } }],
      assignments: [{ id: "a1", org_id: ORG, cohort_id: null, group_id: GROUP, title: "Drive", pack_id: "p", due_at: null, target_mock_count: 1 }],
      group_members: [{ group_id: GROUP, user_id: "me", org_id: ORG }],
    });
    expect((await myAssignments(mine.db, me)).map((a) => a.title)).toEqual(["Drive"]);
    const notMine = fakeDb({
      memberships: [{ user_id: "me", status: "active", role: "member", org_id: ORG, cohort_id: null, organizations: { name: "Sunrise" } }],
      assignments: [{ id: "a1", org_id: ORG, cohort_id: null, group_id: GROUP, title: "Drive", pack_id: "p", due_at: null, target_mock_count: 1 }],
    });
    expect(await myAssignments(notMine.db, me)).toEqual([]);
  });

  it("checkAssignment for a group needs membership", async () => {
    const pack = { id: "behavioural" } as Pack;
    const a = { org_id: ORG, cohort_id: null, group_id: GROUP, pack_id: "behavioural" };
    await expect(checkAssignment(me, ORG, ASSIGN, pack, deps(a, null, { inGroup: async () => true }))).resolves.toBeUndefined();
    await expect(checkAssignment(me, ORG, ASSIGN, pack, deps(a, null, { inGroup: async () => false }))).rejects.toMatchObject({ status: 403 });
  });
});
