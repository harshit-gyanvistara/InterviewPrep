import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { Membership } from "./authz";
import { checkOrgPractice, type OrgPracticeDeps } from "./orgPractice";
import { addUsage, checkOrgEntitlement, requireOrgAllowance, type OrgUsageStore, type UsageStore } from "./policies";
import type { Pack } from "./types";

// Practising for an org (plans/m2-org.md O.4): who may, which rounds, and the org's quota.

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const pack = (id: string, source?: Pack["source"]) => ({ id, source }) as Pack;

function deps(membership: Partial<Membership> | null, settings: unknown = {}): OrgPracticeDeps {
  return {
    store: {
      membership: async () => (membership ? { orgId: ORG, userId: "me", role: "member", status: "active", ...membership } : null),
      shareLevel: async () => undefined,
    },
    settings: async () => settings,
  };
}

describe("checkOrgPractice", () => {
  it("lets an active member practise any round when the org doesn't limit them", async () => {
    await expect(checkOrgPractice(me, ORG, pack("behavioural"), deps({}))).resolves.toBeUndefined();
  });

  it("refuses non-members, removed members, unknown orgs and malformed ids", async () => {
    await expect(checkOrgPractice(me, ORG, pack("b"), deps(null))).rejects.toMatchObject({ status: 403 });
    await expect(checkOrgPractice(me, ORG, pack("b"), deps({ status: "removed" }))).rejects.toMatchObject({ status: 403 });
    await expect(checkOrgPractice(me, ORG, pack("b"), deps({}, null))).rejects.toMatchObject({ status: 403 });
    await expect(checkOrgPractice(me, "not-a-uuid", pack("b"), deps({}))).rejects.toMatchObject({ status: 403 });
  });

  it("keeps to the org's allowed rounds, letting Quick Mocks through", async () => {
    const limited = deps({}, { allowedPackIds: ["behavioural"] });
    await expect(checkOrgPractice(me, ORG, pack("behavioural"), limited)).resolves.toBeUndefined();
    await expect(checkOrgPractice(me, ORG, pack("coding"), limited)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/doesn't include this round/) });
    await expect(checkOrgPractice(me, ORG, pack("mixed-1", "quick"), limited)).resolves.toBeUndefined();
  });

  it("needs the secret key (503)", async () => {
    await expect(checkOrgPractice(me, ORG, pack("b"), { store: null, settings: async () => ({}) })).rejects.toMatchObject({ status: 503 });
  });
});

function orgUsage(allowance: { limit: number | null; period: string } | null, used: number): OrgUsageStore & { since: number[] } {
  const since: number[] = [];
  return {
    since,
    allowance: async () => allowance,
    total: async (_o, _m, s) => (since.push(s), used),
  };
}

describe("org quotas", () => {
  it("treats a missing entitlement as unlimited", async () => {
    expect(await checkOrgEntitlement(ORG, "mocks", orgUsage(null, 999))).toMatchObject({ allowed: true, limit: null });
  });

  it("blocks at the limit with an org message, and points to solo practice", async () => {
    const s = orgUsage({ limit: 100, period: "month" }, 100);
    await expect(requireOrgAllowance(ORG, "mocks", s)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/organisation has used all 100 mock interviews this month.*practise as yourself/) });
    await expect(requireOrgAllowance(ORG, "mocks", orgUsage({ limit: 100, period: "month" }, 99))).resolves.toBeUndefined();
  });

  it("says when the plan includes none (403)", async () => {
    await expect(requireOrgAllowance(ORG, "mocks", orgUsage({ limit: 0, period: "none" }, 0))).rejects.toMatchObject({ status: 403 });
  });

  it("counts a yearly plan from 1 January (IST)", async () => {
    const s = orgUsage({ limit: 10, period: "year" }, 1);
    await checkOrgEntitlement(ORG, "mocks", s);
    const start = new Date(s.since[0] + 5.5 * 3600 * 1000);
    expect([start.getUTCMonth(), start.getUTCDate(), start.getUTCHours()]).toEqual([0, 1, 0]);
  });

  it("fails open when the database can't be read", async () => {
    const broken: OrgUsageStore = { allowance: async () => Promise.reject(new Error("down")), total: async () => 0 };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkOrgEntitlement(ORG, "mocks", broken)).allowed).toBe(true);
    log.mockRestore();
  });

  it("records org practice against the org", async () => {
    const rows: unknown[] = [];
    const store: UsageStore = { total: async () => 0, add: async (r) => void rows.push(r) };
    await addUsage(me, "mocks", { orgId: ORG, store });
    expect(rows).toEqual([expect.objectContaining({ userId: "me", meter: "mocks", orgId: ORG })]);
  });
});
