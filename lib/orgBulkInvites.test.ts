import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { createBulkInvites } from "./orgBulkInvites";
import type { OrgRef } from "./orgInvites";

// Bulk invites with sections (plans/b2b-college.md B.3).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const FIELDS = [{ key: "branch", label: "Branch", required: false }];
const org = (role: string, settings: unknown = { studentFields: FIELDS }): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings, role });
const row = (email: string, section: string[] | null = null, attributes: Record<string, string> = {}) => ({ email, section, attributes });
const body = (rows: ReturnType<typeof row>[], over: Record<string, unknown> = {}) => ({ rows, role: "member" as const, expiresInDays: 14, ...over });

/** Tables answer selects (filtered by eq); inserts into cohorts hand back sequential ids. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; payload: unknown }[] = [];
  let next = 0;
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let inserted = false;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q = {
        select: () => q,
        insert: (p: unknown) => ((inserted = true), writes.push({ table, payload: p }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        order: () => q,
        single: async () => ({ data: { id: `new-${++next}` }, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: inserted ? null : rows(), error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const tree = [
  { id: "cse", org_id: ORG, name: "CSE", parent_id: null, archived: false },
  { id: "y27", org_id: ORG, name: "2027", parent_id: "cse", archived: false },
];

describe("createBulkInvites", () => {
  it("places people in existing sections, with one single-use link each", async () => {
    const { db, writes } = fakeDb({ cohorts: tree });
    const out = await createBulkInvites(db, me, org("admin"), body([row("a@c.edu", ["CSE", "2027"], { branch: "CSE" }), row("b@c.edu")]));
    expect(out.sectionsCreated).toBe(0);
    expect(out.invites.map((i) => [i.email, i.section])).toEqual([["a@c.edu", "CSE / 2027"], ["b@c.edu", null]]);
    const inserted = writes.find((w) => w.table === "invites")!.payload as Record<string, unknown>[];
    expect(inserted[0]).toMatchObject({ email: "a@c.edu", cohort_id: "y27", max_uses: 1, attributes: { branch: "CSE" } });
    expect(inserted[1]).toMatchObject({ cohort_id: null });
    expect(inserted.every((r) => String(r.token_hash).length === 64)).toBe(true);
    expect(JSON.stringify(writes)).not.toContain(out.invites[0].link.slice("/join/".length));
  });

  it("creates missing sections top-down, once per path, and reuses them", async () => {
    const { db, writes } = fakeDb({ cohorts: tree });
    const out = await createBulkInvites(db, me, org("admin"), body([row("a@c.edu", ["CSE", "2027", "A"]), row("b@c.edu", ["CSE", "2027", "A"]), row("c@c.edu", ["ECE"])]));
    expect(out.sectionsCreated).toBe(2);
    const created = writes.filter((w) => w.table === "cohorts").map((w) => w.payload);
    expect(created).toEqual([
      { org_id: ORG, name: "A", parent_id: "y27" },
      { org_id: ORG, name: "ECE", parent_id: null },
    ]);
    const inserted = writes.find((w) => w.table === "invites")!.payload as { cohort_id: string }[];
    expect(inserted[0].cohort_id).toBe(inserted[1].cohort_id);
  });

  it("refuses when the file would not fit the seats, counting waiting invites", async () => {
    const tables = {
      cohorts: [],
      entitlements: [{ org_id: ORG, key: "seats", limit: 5 }],
      memberships: [{ org_id: ORG, status: "active", user_id: "u1" }, { org_id: ORG, status: "active", user_id: "u2" }],
      invites: [{ org_id: ORG, email: "w@c.edu", uses: 0, max_uses: 1, expires_at: null }, { org_id: ORG, email: "done@c.edu", uses: 1, max_uses: 1, expires_at: null }],
    };
    await expect(createBulkInvites(fakeDb(tables).db, me, org("admin"), body([row("a@c.edu"), row("b@c.edu"), row("c@c.edu")]))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("6 of 5") });
    await expect(createBulkInvites(fakeDb(tables).db, me, org("admin"), body([row("a@c.edu"), row("b@c.edu")]))).resolves.toBeDefined();
  });

  it("checks permissions, details, duplicates and the depth of new sections", async () => {
    const f = () => fakeDb({ cohorts: tree }).db;
    await expect(createBulkInvites(f(), me, org("member"), body([row("a@c.edu")]))).rejects.toMatchObject({ status: 403 });
    await expect(createBulkInvites(f(), me, org("admin"), body([row("a@c.edu")], { role: "owner" }))).rejects.toMatchObject({ status: 403 });
    await expect(createBulkInvites(f(), me, org("admin"), body([row("a@c.edu", null, { hobby: "x" })]))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("hobby") });
    await expect(createBulkInvites(f(), me, org("admin"), body([row("a@c.edu"), row("a@c.edu")]))).rejects.toMatchObject({ status: 400 });
    await expect(createBulkInvites(f(), me, org("admin"), body([row("a@c.edu", ["CSE", "2027", "A", "X"])]))).rejects.toMatchObject({ status: 400 });
  });
});
