import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { OrgRef } from "./orgInvites";
import { createOrgPack, listOrgPacks, myOrgPacks, orgPackExists, toOrgPack, updateOrgPack } from "./orgPacks";
import { OrgPackCreateBodySchema, OrgPackUpdateBodySchema } from "./schemas";

// Rounds an organisation owns (plans/b2b-college.md B.5).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role });
const body = { title: "Campus HR", company: "", role: "", roundType: "hr" as const, description: "", durationMin: 20, topics: ["Why this company"], rubric: ["Clarity"], style: "" };
const data = { title: "Campus HR", company: "TCS", role: "Analyst", roundType: "hr", description: "d", durationMin: 20, topics: ["t"], rubric: ["r"], style: "s", domains: "all" };

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        order: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: op === "select" ? rows() : null, error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("body schemas", () => {
  it("fills optional text on create and checks the basics", () => {
    expect(OrgPackCreateBodySchema.parse({ title: "T", roundType: "hr", durationMin: 20, topics: ["a"], rubric: ["b"] })).toMatchObject({ company: "", role: "", description: "", style: "" });
    for (const bad of [{ durationMin: 2 }, { durationMin: 500 }, { topics: [] }, { rubric: [] }, { roundType: "quiz" }, { title: "" }]) {
      expect(OrgPackCreateBodySchema.safeParse({ title: "T", roundType: "hr", durationMin: 20, topics: ["a"], rubric: ["b"], ...bad }).success).toBe(false);
    }
  });

  it("an update only carries what it names, and can't be empty", () => {
    expect(OrgPackUpdateBodySchema.parse({ title: "New" })).toEqual({ title: "New" });
    expect(OrgPackUpdateBodySchema.parse({ archived: true })).toEqual({ archived: true });
    expect(OrgPackUpdateBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("toOrgPack", () => {
  it("takes id, owner and archived from the row", () => {
    expect(toOrgPack({ id: "org-1", org_id: ORG, data: data as never, archived: true })).toMatchObject({ id: "org-1", source: "org", orgId: ORG, archived: true, title: "Campus HR", domains: "all" });
    expect(toOrgPack({ id: "org-2", org_id: ORG, data: { ...data, domains: undefined } as never, archived: null }).archived).toBe(false);
  });
});

describe("managing rounds", () => {
  it("lets coaches, admins and owners make them, and audits it", async () => {
    for (const role of ["coach", "admin", "owner"]) {
      const { db, writes } = fakeDb({});
      const out = await createOrgPack(db, me, org(role), body);
      expect(out.id).toMatch(/^org-[0-9a-f]{12}$/);
      expect(writes.map((w) => w.table)).toEqual(["org_packs", "audit_logs"]);
      expect(writes[0].payload).toMatchObject({ org_id: ORG, created_by: "me", data: { title: "Campus HR", domains: "all" } });
    }
  });

  it("refuses plain members", async () => {
    await expect(createOrgPack(fakeDb({}).db, me, org("member"), body)).rejects.toMatchObject({ status: 403 });
    await expect(listOrgPacks(fakeDb({}).db, org("member"))).rejects.toMatchObject({ status: 403 });
    await expect(updateOrgPack(fakeDb({}).db, me, org("member"), "org-1", { title: "x" })).rejects.toMatchObject({ status: 403 });
  });

  it("edits only the named fields and keeps the rest", async () => {
    const { db, writes } = fakeDb({ org_packs: [{ id: "org-1", org_id: ORG, data, archived: false }] });
    await updateOrgPack(db, me, org("coach"), "org-1", { title: "Renamed", durationMin: 30 });
    expect(writes[0].payload).toEqual({ data: { ...data, title: "Renamed", durationMin: 30 } });
  });

  it("archives without touching the content, and 404s another org's or a missing round", async () => {
    const { db, writes } = fakeDb({ org_packs: [{ id: "org-1", org_id: ORG, data, archived: false }] });
    await updateOrgPack(db, me, org("admin"), "org-1", { archived: true });
    expect(writes[0].payload).toEqual({ archived: true });
    const elsewhere = fakeDb({ org_packs: [{ id: "org-9", org_id: "22222222-2222-2222-2222-222222222222", data, archived: false }] });
    await expect(updateOrgPack(elsewhere.db, me, org("admin"), "org-9", { archived: true })).rejects.toMatchObject({ status: 404 });
  });

  it("lists an org's own rounds, archived ones flagged", async () => {
    const { db } = fakeDb({ org_packs: [{ id: "org-1", org_id: ORG, data, archived: false }, { id: "org-2", org_id: ORG, data, archived: true }, { id: "org-3", org_id: "other", data, archived: false }] });
    expect((await listOrgPacks(db, org("admin"))).map((p) => [p.id, p.archived])).toEqual([["org-1", false], ["org-2", true]]);
  });
});

describe("what a member sees and what can be assigned", () => {
  it("gives a member the rounds of the orgs they are in only", async () => {
    const { db } = fakeDb({
      memberships: [{ user_id: "me", org_id: ORG, status: "active" }, { user_id: "me", org_id: "gone", status: "removed" }],
      org_packs: [{ id: "org-1", org_id: ORG, data, archived: false }, { id: "org-2", org_id: "gone", data, archived: false }, { id: "org-3", org_id: "stranger", data, archived: false }],
    });
    expect((await myOrgPacks(db, me)).map((p) => p.id)).toEqual(["org-1"]);
    expect(await myOrgPacks(fakeDb({}).db, me)).toEqual([]);
  });

  it("only active rounds of the same org can be assigned", async () => {
    const { db } = fakeDb({ org_packs: [{ id: "org-1", org_id: ORG, data, archived: false }, { id: "org-2", org_id: ORG, data, archived: true }] });
    expect(await orgPackExists(db, ORG, "org-1")).toBe(true);
    expect(await orgPackExists(db, ORG, "org-2")).toBe(false);
    expect(await orgPackExists(db, "other", "org-1")).toBe(false);
  });
});
