import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { isSuperAdmin } from "./authz";
import { hashInviteToken, newInviteToken } from "./invites";
import { addOwner, createOrg, entitlementChanges, orgIdFrom, setEntitlements } from "./orgAdmin";
import { EntitlementsBodySchema, OrgCreateBodySchema, OrgUpdateBodySchema } from "./schemas";

// Super-admin org management (plans/m2-org.md O.1).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./supabase-server", async (orig) => ({ ...(await orig<typeof import("./supabase-server")>()), getSupabaseForRequest: vi.fn() }));

const actor: AuthUser = { id: "00000000-0000-0000-0000-00000000000a", email: "boss@offerly.test" };
const ORG = "11111111-1111-1111-1111-111111111111";

/**
 * A tiny stand-in for the Supabase query builder: `tables` answers selects, and every
 * insert/upsert/update/delete is recorded as [table, op, payload, filters].
 */
function fakeDb(tables: Record<string, unknown[]>, opts: { insertError?: { code: string; message: string } } = {}) {
  const ops: [string, string, unknown, [string, unknown][]][] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let op = "select";
      let payload: unknown;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes((r as Record<string, unknown>)[k]) : (r as Record<string, unknown>)[k] === v)));
      const result = () => {
        if (op !== "select") ops.push([table, op, payload, [...filters]]);
        if (op === "insert" && opts.insertError && table === "organizations") return { data: null, error: opts.insertError };
        if (op === "insert" && table === "organizations") return { data: { id: ORG }, error: null };
        return { data: op === "select" ? rows() : [{ id: ORG }], error: null };
      };
      const q = {
        select: () => q,
        insert: (p: unknown) => ((op = "insert"), (payload = p), q),
        upsert: (p: unknown) => ((op = "upsert"), (payload = p), q),
        update: (p: unknown) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v]), q),
        order: () => q,
        limit: () => q,
        single: async () => result(),
        maybeSingle: async () => {
          const r = result();
          return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
        },
        then: (ok: (v: unknown) => void) => ok(result()),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, ops };
}

describe("schemas", () => {
  it("normalises and checks a new org", () => {
    expect(OrgCreateBodySchema.parse({ name: " Sunrise ", slug: "Sunrise-Eng" })).toEqual({ name: "Sunrise", slug: "sunrise-eng", kind: "other" });
    expect(OrgCreateBodySchema.safeParse({ name: "x", slug: "-bad" }).success).toBe(false);
    expect(OrgCreateBodySchema.safeParse({ name: "x", slug: "ok", ownerEmail: "not-an-email" }).success).toBe(false);
    expect(OrgUpdateBodySchema.safeParse({}).success).toBe(false);
  });

  it("accepts any well-formed plan key, and rejects duplicates and negative limits", () => {
    const ok = { entitlements: [{ key: "seats", limit: 200, period: "none" }, { key: "voice_minutes", limit: null, period: "month" }] };
    expect(EntitlementsBodySchema.safeParse(ok).success).toBe(true);
    expect(EntitlementsBodySchema.safeParse({ entitlements: [ok.entitlements[0], ok.entitlements[0]] }).success).toBe(false);
    expect(EntitlementsBodySchema.safeParse({ entitlements: [{ key: "seats", limit: -1, period: "none" }] }).success).toBe(false);
    expect(EntitlementsBodySchema.safeParse({ entitlements: [{ key: "Seats!", limit: 1, period: "none" }] }).success).toBe(false);
  });
});

describe("super-admin list", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("matches emails case-insensitively, and nobody when unset", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", " Boss@Offerly.test , ops@offerly.test");
    expect(isSuperAdmin("boss@offerly.test")).toBe(true);
    expect(isSuperAdmin("someone@offerly.test")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    vi.stubEnv("SUPER_ADMIN_EMAILS", "");
    expect(isSuperAdmin("boss@offerly.test")).toBe(false);
  });
});

describe("invite tokens", () => {
  it("stores only a hash that matches the token", () => {
    const { token, hash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });
});

describe("entitlementChanges", () => {
  it("upserts new and changed keys, removes dropped ones, skips unchanged", () => {
    const current = [
      { key: "seats", limit: 100, period: "none" as const },
      { key: "mocks", limit: 500, period: "month" as const },
      { key: "ai_calls", limit: null, period: "none" as const },
    ];
    const next = [
      { key: "seats", limit: 100, period: "none" as const },
      { key: "mocks", limit: 800, period: "month" as const },
      { key: "voice_minutes", limit: 60, period: "month" as const },
    ];
    expect(entitlementChanges(current, next)).toEqual({ upsert: [next[1], next[2]], remove: ["ai_calls"] });
  });
});

describe("org changes", () => {
  it("creates an org, audits it, and makes an existing user its owner", async () => {
    const { db, ops } = fakeDb({ users: [{ id: "u-owner", email: "head@college.edu" }] });
    const out = await createOrg(db, actor, { name: "Sunrise", slug: "sunrise", kind: "college", ownerEmail: "head@college.edu" });
    expect(out).toEqual({ id: ORG, owner: { added: true } });
    expect(ops.map(([t, op]) => `${t}.${op}`)).toEqual(["organizations.insert", "audit_logs.insert", "memberships.upsert", "audit_logs.insert"]);
    expect(ops[2][2]).toEqual({ org_id: ORG, user_id: "u-owner", role: "owner", status: "active" });
  });

  it("invites an owner who has no account, storing only the token hash", async () => {
    const { db, ops } = fakeDb({ users: [] });
    const out = await addOwner(db, actor, ORG, "new@college.edu");
    expect(out).toMatchObject({ invited: true, link: expect.stringMatching(/^\/join\/[A-Za-z0-9_-]{43}$/) });
    const invite = ops.find(([t]) => t === "invites")![2] as Record<string, unknown>;
    const token = (out as { link: string }).link.slice("/join/".length);
    expect(invite).toMatchObject({ org_id: ORG, email: "new@college.edu", role: "owner", max_uses: 1, token_hash: hashInviteToken(token) });
    expect(JSON.stringify(ops)).not.toContain(token);
  });

  it("turns a taken slug into a 409", async () => {
    const { db } = fakeDb({}, { insertError: { code: "23505", message: "duplicate key" } });
    await expect(createOrg(db, actor, { name: "x", slug: "taken", kind: "other" })).rejects.toMatchObject({ status: 409 });
  });

  it("sets the plan with the minimum writes, and audits only real changes", async () => {
    const { db, ops } = fakeDb({
      organizations: [{ id: ORG }],
      entitlements: [{ org_id: ORG, key: "seats", limit: 100, period: "none" }, { org_id: ORG, key: "ai_calls", limit: 10, period: "day" }],
    });
    await setEntitlements(db, actor, ORG, [{ key: "seats", limit: 100, period: "none" }, { key: "mocks", limit: 1000, period: "month" }]);
    expect(ops.map(([t, op]) => `${t}.${op}`)).toEqual(["entitlements.upsert", "entitlements.delete", "audit_logs.insert"]);
    expect(ops[0][2]).toEqual([{ org_id: ORG, key: "mocks", limit: 1000, period: "month", source: "manual" }]);
    expect(ops[1][3]).toContainEqual(["key", ["ai_calls"]]);

    const again = fakeDb({ organizations: [{ id: ORG }], entitlements: [{ org_id: ORG, key: "seats", limit: 100, period: "none" }] });
    await setEntitlements(again.db, actor, ORG, [{ key: "seats", limit: 100, period: "none" }]);
    expect(again.ops).toEqual([]);
  });

  it("404s an unknown org and a malformed id", async () => {
    const { db } = fakeDb({ organizations: [] });
    await expect(setEntitlements(db, actor, ORG, [])).rejects.toMatchObject({ status: 404 });
    await expect(orgIdFrom({ params: Promise.resolve({ orgId: "../etc" }) })).rejects.toMatchObject({ status: 404 });
  });
});

describe("admin routes", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { getSupabaseForRequest } = await import("./supabase-server");
    vi.mocked(getSupabaseForRequest).mockResolvedValue({
      auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: actor.id, email: actor.email } }, error: null })) },
    } as unknown as SupabaseClient);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("hides the admin API (404) from signed-in users who aren't super-admins", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "someone-else@offerly.test");
    const { GET } = await import("../app/api/admin/orgs/route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("tells a super-admin when the server has no secret key (503)", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", actor.email!);
    const { GET } = await import("../app/api/admin/orgs/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SUPABASE_SECRET_KEY/);
  });
});
