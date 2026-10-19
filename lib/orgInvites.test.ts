import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { Membership, OrgStore } from "./authz";
import { hashInviteToken, newJoinCode, normalizeJoinValue } from "./invites";
import { createInvites, joinOrg, previewInvite, revokeInvite, type OrgRef } from "./orgInvites";
import { redirectFor } from "./pages";
import { InviteCreateBodySchema } from "./schemas";

// Invites, join codes and joining (plans/m2-org.md O.2). The atomic join itself is SQL
// (join_org) and is tested against a real database in supabase/tests/org-rls.test.ts.

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const u = (id: string, email = `${id}@college.edu`): AuthUser => ({ id, email });
const owner = u("owner");
const admin = u("admin");
const member = u("member");
const ORG: OrgRef = { id: "org-1", name: "Sunrise", slug: "sunrise", settings: {} };

const store = (members: Membership[]): OrgStore => ({
  membership: async (orgId, userId) => members.find((m) => m.orgId === orgId && m.userId === userId) ?? null,
  shareLevel: async () => undefined,
});
const roles = store([
  { orgId: ORG.id, userId: "owner", role: "owner", status: "active" },
  { orgId: ORG.id, userId: "admin", role: "admin", status: "active" },
  { orgId: ORG.id, userId: "member", role: "member", status: "active" },
]);

/** Records writes; `answers` gives what selects (maybeSingle) and rpc return. */
function fakeDb(answers: { select?: Record<string, unknown>; rpc?: unknown; updateRows?: unknown[] } = {}) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      const q = {
        select: () => q,
        insert: (p: unknown) => (writes.push({ table, op: "insert", payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op: "update", payload: p }), q),
        eq: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: answers.select?.[table] ?? null, error: null }),
        then: (ok: (v: unknown) => void) => ok({ data: op === "update" ? (answers.updateRows ?? []) : [], error: null }),
      };
      return q;
    },
    rpc: vi.fn(async () => ({ data: answers.rpc, error: null })),
  };
  return { db: db as unknown as SupabaseClient & { rpc: typeof db.rpc }, writes };
}

describe("join codes and tokens", () => {
  it("makes readable codes and matches them however they're typed", () => {
    const { code, hash } = newJoinCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    for (const typed of [code, code.toLowerCase(), code.replace("-", " "), ` ${code.replace("-", "")} `]) {
      expect(hashInviteToken(normalizeJoinValue(typed))).toBe(hash);
    }
  });

  it("uses long tokens exactly as given", () => {
    const token = "SXZQeIdLIkoPZxnNctLgd0_ZrlPpXp5qy0dOM0VNYKY";
    expect(normalizeJoinValue(token)).toBe(token);
  });
});

describe("invite schema", () => {
  it("validates email invites and codes", () => {
    expect(InviteCreateBodySchema.parse({ kind: "email", emails: ["A@College.edu"] })).toEqual({ kind: "email", emails: ["a@college.edu"], role: "member", expiresInDays: 14 });
    expect(InviteCreateBodySchema.parse({ kind: "code" })).toEqual({ kind: "code", role: "member", expiresInDays: 14, maxUses: null });
    expect(InviteCreateBodySchema.safeParse({ kind: "email", emails: [] }).success).toBe(false);
    expect(InviteCreateBodySchema.safeParse({ kind: "code", role: "superuser" }).success).toBe(false);
  });
});

describe("createInvites", () => {
  it("lets admins invite members, with one single-use link per email and only hashes stored", async () => {
    const { db, writes } = fakeDb();
    const out = await createInvites(db, admin, ORG, { kind: "email", emails: ["a@college.edu", "b@college.edu", "a@college.edu"], role: "member", expiresInDays: 14 }, roles);
    expect(out.invites.map((i) => i.email)).toEqual(["a@college.edu", "b@college.edu"]);
    const rows = writes.find((w) => w.table === "invites")!.payload as { token_hash: string; max_uses: number; email: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.max_uses === 1 && r.token_hash.length === 64)).toBe(true);
    for (const i of out.invites) expect(JSON.stringify(writes)).not.toContain(i.link.slice("/join/".length));
    expect(writes.some((w) => w.table === "audit_logs")).toBe(true);
  });

  it("returns a join code once and stores its hash", async () => {
    const { db, writes } = fakeDb();
    const out = await createInvites(db, admin, ORG, { kind: "code", role: "member", expiresInDays: 14, maxUses: 60 }, roles);
    const { code } = out.invites[0];
    expect(code).toBeDefined();
    const row = writes.find((w) => w.table === "invites")!.payload as { token_hash: string; email: null; max_uses: number };
    expect(row).toMatchObject({ email: null, max_uses: 60, token_hash: hashInviteToken(normalizeJoinValue(code!)) });
  });

  it("refuses members, and owner invites from anyone but an owner", async () => {
    const body = { kind: "email" as const, emails: ["x@college.edu"], role: "member" as const, expiresInDays: 14 };
    await expect(createInvites(fakeDb().db, member, ORG, body, roles)).rejects.toMatchObject({ status: 403 });
    await expect(createInvites(fakeDb().db, admin, ORG, { ...body, role: "owner" }, roles)).rejects.toMatchObject({ status: 403 });
    await expect(createInvites(fakeDb().db, owner, ORG, { ...body, role: "owner" }, roles)).resolves.toBeDefined();
  });
});

describe("revokeInvite", () => {
  it("expires the invite, and 404s one from another org", async () => {
    const ok = fakeDb({ updateRows: [{ id: "i1" }] });
    await revokeInvite(ok.db, admin, ORG, "i1", roles);
    expect(ok.writes[0]).toMatchObject({ table: "invites", op: "update" });
    await expect(revokeInvite(fakeDb({ updateRows: [] }).db, admin, ORG, "elsewhere", roles)).rejects.toMatchObject({ status: 404 });
    await expect(revokeInvite(fakeDb().db, member, ORG, "i1", roles)).rejects.toMatchObject({ status: 403 });
  });
});

describe("previewInvite", () => {
  const invite = (over: Record<string, unknown> = {}) => ({ org_id: ORG.id, email: null, role: "member", uses: 0, max_uses: null, expires_at: null, organizations: { name: "Sunrise", settings: { defaultShareLevel: "full" } }, ...over });

  it("shows the org and its default share level", async () => {
    const out = await previewInvite(fakeDb({ select: { invites: invite() } }).db, member, "K7QM4-XR2PD");
    expect(out).toEqual({ status: "ok", orgName: "Sunrise", role: "member", defaultShareLevel: "full", alreadyMember: false });
  });

  it("explains invalid, expired, used-up and wrong-email invites", async () => {
    expect((await previewInvite(fakeDb().db, member, "nope")).status).toBe("invalid");
    expect((await previewInvite(fakeDb({ select: { invites: invite({ expires_at: "2000-01-01T00:00:00Z" }) } }).db, member, "x")).status).toBe("expired");
    expect((await previewInvite(fakeDb({ select: { invites: invite({ uses: 1, max_uses: 1 }) } }).db, member, "x")).status).toBe("used_up");
    expect((await previewInvite(fakeDb({ select: { invites: invite({ email: "someone@else.com" }) } }).db, member, "x")).status).toBe("wrong_email");
  });

  it("an existing member sees the org even on a used invite", async () => {
    const out = await previewInvite(fakeDb({ select: { invites: invite({ uses: 1, max_uses: 1 }), memberships: { status: "active" } } }).db, member, "x");
    expect(out).toMatchObject({ status: "ok", alreadyMember: true });
  });
});

describe("joinOrg", () => {
  it("passes the hashed value and consent to join_org", async () => {
    const { db } = fakeDb({ rpc: { status: "joined", slug: "sunrise" } });
    expect(await joinOrg(db, member, "k7qm4-xr2pd", "scores")).toEqual({ slug: "sunrise", alreadyMember: false });
    expect(db.rpc).toHaveBeenCalledWith("join_org", expect.objectContaining({ p_token_hash: hashInviteToken("K7QM4XR2PD"), p_user: "member", p_share_level: "scores", p_consent_version: expect.any(String) }));
  });

  it.each([
    ["no_seats", 409, /no free seats/],
    ["wrong_email", 403, /different email/],
    ["domain_not_allowed", 403, /own email addresses/],
    ["expired", 410, /expired/],
    ["invalid", 404, /isn't valid/],
  ])("turns %s into a clear %i", async (status, code, message) => {
    await expect(joinOrg(fakeDb({ rpc: { status } }).db, member, "x", "scores")).rejects.toMatchObject({ status: code, message: expect.stringMatching(message) });
  });
});

describe("page routing for invites", () => {
  const out = { mode: "supabase" as const, user: null };
  const signedIn = { mode: "supabase" as const, user: { id: "u", email: "u@x.com" } };

  it("opens invite pages for everyone, signed out or not onboarded", () => {
    expect(redirectFor("/join/abc", out as never, false)).toBeNull();
    expect(redirectFor("/join/abc", signedIn as never, false)).toBeNull();
  });

  it("brings a signed-in person back to a pending invite before onboarding", () => {
    expect(redirectFor("/onboarding", signedIn as never, false, "K7QM4-XR2PD")).toBe("/join/K7QM4-XR2PD");
    expect(redirectFor("/", signedIn as never, true, "tok")).toBe("/join/tok");
    expect(redirectFor("/", out as never, false, "tok")).toBe("/welcome");
  });
});
