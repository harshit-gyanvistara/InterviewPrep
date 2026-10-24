import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { OrgRef } from "./orgInvites";
import { applyKit, installKit } from "./orgKits";
import { COLLEGE_PLACEMENT } from "./starterKits";

// Applying a starter kit (plans/b2b-college.md B.7).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string): OrgRef => ({ id: ORG, name: "Sunrise", slug: "sunrise", settings: {}, role });

function fakeDb(settings: Record<string, unknown> | null, failOn?: string) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  let next = 0;
  const db = {
    from(table: string) {
      let op = "select";
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        delete: () => ((op = "delete"), writes.push({ table, op }), q),
        eq: () => q,
        in: () => q,
        single: async () => ({ data: { id: `plan-${++next}` }, error: null }),
        maybeSingle: async () => ({ data: settings === null ? null : { id: ORG, settings }, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: null, error: failOn === `${table}.${op}` ? { message: "boom" } : null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("installKit", () => {
  it("copies the rounds and plans into the org and records the kit", async () => {
    const { db, writes } = fakeDb({});
    const out = await installKit(db, me, ORG, "college-placement");
    expect(out).toEqual({ rounds: COLLEGE_PLACEMENT.rounds.length, plans: COLLEGE_PLACEMENT.plans.length });

    const rounds = writes.find((w) => w.table === "org_packs")!.payload as { id: string; org_id: string; data: Record<string, unknown> }[];
    expect(rounds).toHaveLength(COLLEGE_PLACEMENT.rounds.length);
    expect(rounds.every((r) => /^org-[0-9a-f]{12}$/.test(r.id) && r.org_id === ORG && r.data.domains === "all" && !("key" in r.data))).toBe(true);

    // Plan stages point at the NEW round ids, not at the kit's keys.
    const ids = new Set(rounds.map((r) => r.id));
    const stages = writes.filter((w) => w.table === "trajectory_stages").flatMap((w) => w.payload as { pack_id: string; position: number }[]);
    expect(stages.length).toBe(COLLEGE_PLACEMENT.plans.reduce((n, p) => n + p.stages.length, 0));
    expect(stages.every((s) => ids.has(s.pack_id))).toBe(true);
    expect(stages.filter((s) => s.position === 1)).toHaveLength(COLLEGE_PLACEMENT.plans.length);

    const update = writes.find((w) => w.table === "organizations")!.payload as { settings: Record<string, unknown> };
    expect(update.settings).toMatchObject({ minShareLevel: "scores", kit: { id: "college-placement", version: 1 } });
    expect(writes.at(-1)).toMatchObject({ table: "audit_logs" });
  });

  it("gives each org its own rounds (ids differ between applications)", async () => {
    const a = fakeDb({});
    const b = fakeDb({});
    await installKit(a.db, me, ORG, "college-placement");
    await installKit(b.db, me, ORG, "college-placement");
    const idsOf = (w: typeof a.writes) => (w.find((x) => x.table === "org_packs")!.payload as { id: string }[]).map((r) => r.id);
    expect(idsOf(a.writes).some((id) => idsOf(b.writes).includes(id))).toBe(false);
  });

  it("only fills settings the org hasn't set", async () => {
    const mine = [{ key: "section", label: "Section", required: true }];
    const { db, writes } = fakeDb({ minShareLevel: "full", studentFields: mine });
    await installKit(db, me, ORG, "college-placement");
    const settings = (writes.find((w) => w.table === "organizations")!.payload as { settings: Record<string, unknown> }).settings;
    expect(settings.minShareLevel).toBe("full");
    expect(settings.studentFields).toEqual(mine);
    expect(settings.defaultShareLevel).toBe("scores");
  });

  it("applies once per org, and refuses unknown kits and unknown orgs", async () => {
    await expect(installKit(fakeDb({ kit: { id: "college-placement" } }).db, me, ORG, "college-placement")).rejects.toMatchObject({ status: 409 });
    await expect(installKit(fakeDb({}).db, me, ORG, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(installKit(fakeDb(null).db, me, ORG, "college-placement")).rejects.toMatchObject({ status: 404 });
  });

  it("removes what it added if a step fails, and leaves the org unmarked", async () => {
    const { db, writes } = fakeDb({}, "trajectory_stages.insert");
    await expect(installKit(db, me, ORG, "college-placement")).rejects.toThrow(/boom/);
    expect(writes.some((w) => w.table === "org_packs" && w.op === "delete")).toBe(true);
    expect(writes.some((w) => w.table === "trajectories" && w.op === "delete")).toBe(true);
    expect(writes.some((w) => w.table === "organizations" && w.op === "update")).toBe(false);
    expect(writes.some((w) => w.table === "audit_logs")).toBe(false);
  });
});

describe("applyKit", () => {
  it("is for owners and admins only", async () => {
    await expect(applyKit(fakeDb({}).db, me, org("admin"), "college-placement")).resolves.toBeDefined();
    await expect(applyKit(fakeDb({}).db, me, org("owner"), "college-placement")).resolves.toBeDefined();
    await expect(applyKit(fakeDb({}).db, me, org("coach"), "college-placement")).rejects.toMatchObject({ status: 403 });
    await expect(applyKit(fakeDb({}).db, me, org("member"), "college-placement")).rejects.toMatchObject({ status: 403 });
  });
});
