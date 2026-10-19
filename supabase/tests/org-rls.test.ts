import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Cross-org isolation on the organisation tables (supabase/migrations/*_organizations.sql,
// plans/org-ready-schema.md), against a real database. Same setup as rls.test.ts; skipped when
// SUPABASE_TEST_URL isn't set. CI runs it in the `database` job.

const url = process.env.SUPABASE_TEST_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY ?? "";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

type Name = "adminA" | "memberA" | "memberB" | "loner";

describe.skipIf(!url)("organisation tables: cross-org isolation", () => {
  let admin: SupabaseClient;
  const users = {} as Record<Name, { id: string; client: SupabaseClient }>;
  const org = {} as Record<"a" | "b", string>;
  const run = Date.now();

  beforeAll(async () => {
    admin = createClient(url!, secretKey, opts);
    for (const name of ["adminA", "memberA", "memberB", "loner"] as const) {
      const email = `org-${name.toLowerCase()}-${run}@example.test`;
      const password = `pw-${run}-${name}!`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const client = createClient(url!, publishableKey, opts);
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      users[name] = { id: data.user.id, client };
    }
    // Org setup is server-only, so it goes through the secret key, as M2-Org routes will.
    for (const k of ["a", "b"] as const) {
      const { data, error } = await admin.from("organizations").insert({ name: `Org ${k}`, slug: `org-${k}-${run}`, kind: "college" }).select("id").single();
      if (error) throw error;
      org[k] = data.id;
      await admin.from("cohorts").insert({ org_id: data.id, name: `Cohort ${k}` });
      await admin.from("assignments").insert({ org_id: data.id, pack_id: "behavioural", title: `Assignment ${k}` });
      await admin.from("entitlements").insert({ org_id: data.id, key: "seats", limit: 10 });
      await admin.from("invites").insert({ org_id: data.id, token_hash: `hash-${k}-${run}` });
      await admin.from("audit_logs").insert({ org_id: data.id, action: "test.setup" });
    }
    const { error } = await admin.from("memberships").insert([
      { org_id: org.a, user_id: users.adminA.id, role: "admin" },
      { org_id: org.a, user_id: users.memberA.id, role: "member" },
      { org_id: org.b, user_id: users.memberB.id, role: "member" },
    ]);
    if (error) throw error;
    // memberA practises in org A; nobody else may read it, not even org A's admin.
    await admin.from("sessions").insert({ user_id: users.memberA.id, id: `s-${run}`, org_id: org.a, data: { id: `s-${run}` } });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("organizations").delete().in("id", Object.values(org));
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  });

  it("a member sees only their own org, its cohorts and assignments", async () => {
    const { client } = users.memberA;
    expect((await client.from("organizations").select("id")).data?.map((r) => r.id)).toEqual([org.a]);
    expect((await client.from("cohorts").select("org_id")).data?.every((r) => r.org_id === org.a)).toBe(true);
    expect((await client.from("assignments").select("org_id")).data?.map((r) => r.org_id)).toEqual([org.a]);
    expect((await client.from("organizations").select("id").eq("id", org.b)).data).toEqual([]);
  });

  it("memberships are visible only to their own user", async () => {
    const rows = (await users.adminA.client.from("memberships").select("user_id")).data;
    expect(rows?.map((r) => r.user_id)).toEqual([users.adminA.id]);
  });

  it("a user in no org sees no org data", async () => {
    const { client } = users.loner;
    for (const table of ["organizations", "cohorts", "memberships", "assignments"]) {
      expect((await client.from(table).select("*")).data ?? [], table).toEqual([]);
    }
  });

  it("entitlements, invites and audit logs are server-only", async () => {
    for (const table of ["entitlements", "invites", "audit_logs"]) {
      const r = await users.adminA.client.from(table).select("*");
      expect(r.data ?? [], table).toEqual([]);
    }
  });

  it("users can't create or change org rows, or make themselves members", async () => {
    const { client, id } = users.loner;
    expect((await client.from("organizations").insert({ name: "Mine", slug: `mine-${run}` })).error).not.toBeNull();
    expect((await client.from("memberships").insert({ org_id: org.a, user_id: id, role: "owner" })).error).not.toBeNull();
    expect((await users.memberA.client.from("memberships").update({ role: "owner" }).eq("user_id", users.memberA.id)).error).not.toBeNull();
    expect((await users.adminA.client.from("assignments").insert({ org_id: org.a, pack_id: "x", title: "x" })).error).not.toBeNull();
    const { data } = await admin.from("memberships").select("role").eq("user_id", users.memberA.id).single();
    expect(data?.role).toBe("member");
  });

  it("an org admin can't read a member's sessions through the database", async () => {
    expect((await users.adminA.client.from("sessions").select("*").eq("user_id", users.memberA.id)).data ?? []).toEqual([]);
    expect((await users.memberB.client.from("sessions").select("*").eq("org_id", org.a)).data ?? []).toEqual([]);
  });

  it("a removed member loses access", async () => {
    await admin.from("memberships").update({ status: "removed" }).eq("user_id", users.memberA.id).eq("org_id", org.a);
    expect((await users.memberA.client.from("organizations").select("id")).data).toEqual([]);
    expect((await users.memberA.client.from("assignments").select("id")).data).toEqual([]);
    await admin.from("memberships").update({ status: "active" }).eq("user_id", users.memberA.id).eq("org_id", org.a);
  });

  it("deleting an org keeps members' practice, unlinked from it", async () => {
    const { data: temp } = await admin.from("organizations").insert({ name: "Temp", slug: `temp-${run}` }).select("id").single();
    await admin.from("sessions").update({ org_id: temp!.id }).eq("id", `s-${run}`);
    await admin.from("organizations").delete().eq("id", temp!.id);
    const { data } = await admin.from("sessions").select("org_id").eq("id", `s-${run}`).single();
    expect(data).toEqual({ org_id: null });
  });
});

// join_org (supabase/migrations/*_join_org.sql, plans/m2-org.md O.2): invite checks and the seat limit, atomically.
describe.skipIf(!url)("join_org", () => {
  let admin: SupabaseClient;
  const people: { id: string; email: string }[] = [];
  let orgId = "";
  const run = Date.now();
  const join = (hash: string, i: number, share = "scores") =>
    admin.rpc("join_org", { p_token_hash: hash, p_user: people[i].id, p_email: people[i].email, p_share_level: share, p_consent_version: "test" }).then((r) => (r.data as { status: string }).status);

  beforeAll(async () => {
    admin = createClient(url!, secretKey, opts);
    for (let i = 0; i < 4; i++) {
      const email = `join-${i}-${run}@college.edu`;
      const { data, error } = await admin.auth.admin.createUser({ email, password: `pw-${run}-${i}!`, email_confirm: true });
      if (error) throw error;
      people.push({ id: data.user.id, email });
    }
    const { data } = await admin.from("organizations").insert({ name: "Join test", slug: `join-${run}`, settings: { allowedEmailDomains: ["college.edu"] } }).select("id").single();
    orgId = data!.id;
    await admin.from("entitlements").insert({ org_id: orgId, key: "seats", limit: 2 });
    await admin.from("invites").insert([
      { org_id: orgId, token_hash: `code-${run}`, role: "member" },
      { org_id: orgId, token_hash: `email-${run}`, email: people[3].email, role: "coach", max_uses: 1 },
      { org_id: orgId, token_hash: `old-${run}`, role: "member", expires_at: "2000-01-01T00:00:00Z" },
    ]);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("audit_logs").delete().eq("org_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("rejects unknown and expired invites", async () => {
    expect(await join("nope", 0)).toBe("invalid");
    expect(await join(`old-${run}`, 0)).toBe("expired");
  });

  it("enforces the seat limit even when people join at the same moment", async () => {
    const results = await Promise.all([0, 1, 2].map((i) => join(`code-${run}`, i)));
    expect(results.filter((s) => s === "joined")).toHaveLength(2);
    expect(results.filter((s) => s === "no_seats")).toHaveLength(1);
    const { count } = await admin.from("memberships").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active");
    expect(count).toBe(2);
  });

  it("records the member's sharing consent and an audit entry, and is idempotent", async () => {
    const { data: consents } = await admin.from("consents").select("value").eq("org_id", orgId).eq("kind", "org_share");
    expect(consents?.length).toBe(2);
    expect(consents?.[0].value).toEqual({ shareLevel: "scores" });
    const { data: logs } = await admin.from("audit_logs").select("action").eq("org_id", orgId).eq("action", "member.joined");
    expect(logs?.length).toBe(2);
    const member = (await admin.from("memberships").select("user_id").eq("org_id", orgId).limit(1).single()).data!.user_id;
    expect(await join(`code-${run}`, people.findIndex((p) => p.id === member))).toBe("already_member");
  });

  it("binds email invites to their address", async () => {
    await admin.from("entitlements").update({ limit: 10 }).eq("org_id", orgId).eq("key", "seats");
    // Person 2 may or may not have won a seat above; either way the coach invite isn't theirs.
    expect(await join(`email-${run}`, 2)).toMatch(/^(wrong_email|already_member)$/);
    expect(await join(`email-${run}`, 3)).toBe("joined");
    const { data } = await admin.from("memberships").select("role").eq("user_id", people[3].id).single();
    expect(data?.role).toBe("coach");
  });

  it("limits join codes to the org's email domains", async () => {
    const outsider = await admin.auth.admin.createUser({ email: `join-out-${run}@gmail.com`, password: `pw-${run}-o!`, email_confirm: true });
    const id = outsider.data.user!.id;
    const { data } = await admin.rpc("join_org", { p_token_hash: `code-${run}`, p_user: id, p_email: `join-out-${run}@gmail.com`, p_share_level: "scores", p_consent_version: "test" });
    expect((data as { status: string }).status).toBe("domain_not_allowed");
    await admin.auth.admin.deleteUser(id);
  });
});
