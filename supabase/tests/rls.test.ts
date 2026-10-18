import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Row-level security on the account tables (supabase/migrations/*_accounts.sql), against a real
// database: one user must never read or change another's rows through the publishable key.
// Needs a local Supabase with the migrations applied:
//
//   npx supabase start
//   eval "$(npx supabase status -o env)"
//   SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_TEST_SECRET_KEY=$SECRET_KEY npm test -- supabase/tests
//
// CI runs it in the `database` job. Skipped when SUPABASE_TEST_URL isn't set.

const url = process.env.SUPABASE_TEST_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY ?? "";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!url)("account tables: row-level security", () => {
  let admin: SupabaseClient;
  const users: Record<"a" | "b", { id: string; client: SupabaseClient }> = {} as never;
  const run = Date.now();

  beforeAll(async () => {
    admin = createClient(url!, secretKey, opts);
    for (const name of ["a", "b"] as const) {
      const email = `rls-${name}-${run}@example.test`;
      const password = `pw-${run}-${name}!`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const client = createClient(url!, publishableKey, opts);
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      users[name] = { id: data.user.id, client };
    }
    const { error } = await users.b.client.from("profiles").insert({ user_id: users.b.id, data: { name: "B" } });
    if (error) throw error;
  });

  afterAll(async () => {
    for (const u of Object.values(users)) await admin?.auth.admin.deleteUser(u.id);
  });

  it("sign-up creates the users row, visible only to its owner", async () => {
    const own = await users.a.client.from("users").select("id, email");
    expect(own.error).toBeNull();
    expect(own.data?.map((r) => r.id)).toEqual([users.a.id]);
  });

  it("a user can write and read their own profile", async () => {
    const insert = await users.a.client.from("profiles").upsert({ user_id: users.a.id, data: { name: "A" } });
    expect(insert.error).toBeNull();
    const read = await users.a.client.from("profiles").select("user_id, data");
    expect(read.data).toEqual([{ user_id: users.a.id, data: { name: "A" } }]);
  });

  it("another user's profile can't be read, created, changed or deleted", async () => {
    const { client } = users.a;
    const read = await client.from("profiles").select("user_id").eq("user_id", users.b.id);
    expect(read.data).toEqual([]);

    const insert = await client.from("profiles").insert({ user_id: users.b.id, data: { name: "hijack" } });
    expect(insert.error).not.toBeNull();

    const update = await client.from("profiles").update({ data: { name: "hijack" } }).eq("user_id", users.b.id).select();
    expect(update.data ?? []).toEqual([]);
    const del = await client.from("profiles").delete().eq("user_id", users.b.id).select();
    expect(del.data ?? []).toEqual([]);

    const stillThere = await admin.from("profiles").select("data").eq("user_id", users.b.id).single();
    expect(stillThere.data?.data).toEqual({ name: "B" });
  });

  it("users can't change their own id or email, only display fields", async () => {
    const { client, id } = users.a;
    expect((await client.from("users").update({ display_name: "Asha" }).eq("id", id)).error).toBeNull();
    expect((await client.from("users").update({ email: "other@example.test" }).eq("id", id)).error).not.toBeNull();
  });

  it("consents are append-only and per user", async () => {
    const { client, id } = users.a;
    expect((await client.from("consents").insert({ user_id: id, kind: "terms", version: "t1" })).error).toBeNull();
    expect((await client.from("consents").insert({ user_id: users.b.id, kind: "terms", version: "t1" })).error).not.toBeNull();
    expect((await client.from("consents").insert({ user_id: id, kind: "terms", version: "t1", revoked_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await client.from("consents").update({ version: "forged" }).eq("user_id", id)).error).not.toBeNull();
  });

  it("usage_ledger: users read only their own rows and can't write or erase them", async () => {
    const { client, id } = users.a;
    expect((await client.from("usage_ledger").insert({ user_id: id, meter: "mocks" })).error).not.toBeNull();
    expect((await client.from("usage_ledger").delete().eq("user_id", id)).error).not.toBeNull();
    expect((await client.from("usage_ledger").select("*").eq("user_id", users.b.id)).data ?? []).toEqual([]);
    expect((await client.rpc("usage_total", { p_user: id, p_meter: "mocks", p_since: new Date(0).toISOString() })).error).not.toBeNull();
  });

  it("anonymous requests see nothing", async () => {
    const anon = createClient(url!, publishableKey, opts);
    for (const table of ["users", "profiles", "consents", "usage_ledger"]) {
      const { data } = await anon.from(table).select("*");
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("deleting the account removes its rows", async () => {
    const temp = await admin.auth.admin.createUser({ email: `rls-temp-${run}@example.test`, password: `pw-${run}-t!`, email_confirm: true });
    const tempId = temp.data.user!.id;
    await admin.from("profiles").insert({ user_id: tempId, data: {} });
    await admin.auth.admin.deleteUser(tempId);
    expect((await admin.from("users").select("id").eq("id", tempId)).data).toEqual([]);
    expect((await admin.from("profiles").select("user_id").eq("user_id", tempId)).data).toEqual([]);
  });
});
