import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { memberContext } from "./orgContextServer";

// The context a member's interviews carry: the org's, then each section from the top down (plans/b2b-college.md B.8).

const ORG = "11111111-1111-1111-1111-111111111111";

function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: rows(), error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const cohorts = [
  { id: "cse", org_id: ORG, name: "CSE", parent_id: null, context: { techStack: "Java, SQL", notes: "" } },
  { id: "y27", org_id: ORG, name: "2027", parent_id: "cse", context: {} },
  { id: "a", org_id: ORG, name: "A", parent_id: "y27", context: { companies: "Amazon" } },
  { id: "ece", org_id: ORG, name: "ECE", parent_id: null, context: { techStack: "C, embedded" } },
];
const org = { id: ORG, name: "Sunrise", settings: { context: { companies: "TCS, Infosys", notes: "Be kind" } } };
const member = (cohort_id: string | null) => ({ org_id: ORG, user_id: "u1", status: "active", cohort_id });

describe("memberContext", () => {
  it("merges the org with every section above the member, the nearest winning", async () => {
    const got = await memberContext(fakeDb({ organizations: [org], memberships: [member("a")], cohorts }), ORG, "u1");
    expect(got).toEqual({ orgName: "Sunrise", companies: "Amazon", roles: "", techStack: "Java, SQL", notes: "Be kind" });
  });

  it("uses only the org's context for a member in no section", async () => {
    const got = await memberContext(fakeDb({ organizations: [org], memberships: [member(null)], cohorts }), ORG, "u1");
    expect(got).toMatchObject({ companies: "TCS, Infosys", techStack: "" });
  });

  it("does not leak another department's context", async () => {
    const got = await memberContext(fakeDb({ organizations: [org], memberships: [member("ece")], cohorts }), ORG, "u1");
    expect(got?.techStack).toBe("C, embedded");
    expect(got?.companies).toBe("TCS, Infosys");
  });

  it("is null when nothing is set anywhere, or the org is missing", async () => {
    const bare = { id: ORG, name: "Sunrise", settings: {} };
    const quiet = cohorts.map((c) => ({ ...c, context: {} }));
    expect(await memberContext(fakeDb({ organizations: [bare], memberships: [member("y27")], cohorts: quiet }), ORG, "u1")).toBeNull();
    expect(await memberContext(fakeDb({ organizations: [], memberships: [], cohorts: [] }), ORG, "u1")).toBeNull();
  });
});
