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
