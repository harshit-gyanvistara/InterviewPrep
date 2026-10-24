import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { getContexts, setOrgContext, setSectionContext } from "./orgContextAdmin";
import type { OrgRef } from "./orgInvites";
import { ContextBodySchema } from "./schemas";

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string, settings: unknown = { allowedPackIds: ["x"], context: { companies: "TCS" } }): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings, role });

function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q = {
        select: () => q,
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        order: () => q,
        then: (ok: (v: unknown) => void) => ok({ data: op === "insert" ? null : rows(), error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("context editing", () => {
  it("defaults missing fields to empty and caps their length", () => {
    expect(ContextBodySchema.parse({ context: { notes: "hi" } }).context).toEqual({ companies: "", roles: "", techStack: "", notes: "hi" });
    expect(ContextBodySchema.safeParse({ context: { notes: "x".repeat(1501) } }).success).toBe(false);
  });

  it("owners and admins only", async () => {
    for (const role of ["coach", "member"]) {
      await expect(getContexts(fakeDb({}).db, org(role))).rejects.toMatchObject({ status: 403 });
      await expect(setOrgContext(fakeDb({}).db, me, org(role), { companies: "", roles: "", techStack: "", notes: "" })).rejects.toMatchObject({ status: 403 });
      await expect(setSectionContext(fakeDb({}).db, me, org(role), "c", { companies: "", roles: "", techStack: "", notes: "" })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("reads the org's context and each section's, in tree order with paths", async () => {
    const { db } = fakeDb({
      cohorts: [
        { id: "y", org_id: ORG, name: "2027", parent_id: "d", archived: false, context: { roles: "Analyst" } },
        { id: "d", org_id: ORG, name: "CSE", parent_id: null, archived: false, context: { techStack: "Java" } },
      ],
    });
    const out = await getContexts(db, org("admin"));
    expect(out.org.companies).toBe("TCS");
    expect(out.sections.map((s) => [s.path, s.context.techStack, s.context.roles])).toEqual([["CSE", "Java", ""], ["CSE / 2027", "", "Analyst"]]);
  });

  it("saves the org's context without disturbing its other settings", async () => {
    const { db, writes } = fakeDb({});
    await setOrgContext(db, me, org("owner"), { companies: " Amazon ", roles: "", techStack: "", notes: "" });
    expect(writes[0].payload).toEqual({ settings: { allowedPackIds: ["x"], context: { companies: "Amazon", roles: "", techStack: "", notes: "" } } });
    expect(writes.some((w) => w.table === "audit_logs")).toBe(true);
  });

  it("saves a section's context, and 404s a section from another org", async () => {
    const { db, writes } = fakeDb({ cohorts: [{ id: "d", org_id: ORG }] });
    await setSectionContext(db, me, org("admin"), "d", { companies: "", roles: "", techStack: "SQL", notes: "" });
    expect(writes[0]).toMatchObject({ table: "cohorts", payload: { context: { techStack: "SQL" } } });
    await expect(setSectionContext(fakeDb({ cohorts: [{ id: "z", org_id: "other" }] }).db, me, org("admin"), "z", { companies: "", roles: "", techStack: "", notes: "" })).rejects.toMatchObject({ status: 404 });
  });
});
