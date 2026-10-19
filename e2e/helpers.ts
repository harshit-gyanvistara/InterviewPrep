import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Shared setup for the end-to-end tests (plans/m2-org.md O.7): real accounts in the local
// Supabase, signed in through the app's own code-verification route, and a cleanup list.

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin: SupabaseClient = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SECRET_KEY!, opts);

export const RUN = Date.now().toString(36);
export const email = (who: string) => `e2e-${who}-${RUN}@e2e-offerly.dev`;

const created: string[] = [];
const orgSlugs: string[] = [];

/** A confirmed account with no profile yet, so the app sends it through onboarding. */
export async function createAccount(address: string): Promise<string> {
  const existing = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === address);
  const id = existing?.id ?? (await admin.auth.admin.createUser({ email: address, email_confirm: true })).data.user!.id;
  if (!existing) created.push(id);
  return id;
}

/** A confirmed account with a finished profile, so the app goes straight past onboarding. */
export async function createUser(address: string, name: string): Promise<string> {
  const id = await createAccount(address);
  const profile = { id: "me", name, targetRole: "Backend Developer", targetCompanies: "", jobDescription: "", experience: "fresher", resume: "", weeklyGoal: 3, onboarded: true, createdAt: Date.now() };
  const { error } = await admin.from("profiles").upsert({ user_id: id, data: profile }, { onConflict: "user_id" });
  if (error) throw error;
  return id;
}

/** Signs `page`'s browser context in as `address`: a one-time code from the admin API, verified by the app. */
export async function signIn(page: Page, address: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: address });
  if (error) throw error;
  const res = await page.request.post("/api/auth/verify", { data: { email: address, code: data.properties.email_otp } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A new browser context (its own cookies), signed in. */
export async function signedIn(browser: Browser, address: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, address);
  // Turn off auto-listen and voice so headless runs never wait on speech.
  await page.request.put("/api/db/settings", { data: { id: "settings", autoListen: false, voiceReply: false, confirmEnd: true } });
  return page;
}

export function trackOrg(slug: string) {
  orgSlugs.push(slug);
}

/** JSON from an API route as this page's user; fails the test on an error status unless `allow` lists it. */
export async function api<T = unknown>(req: APIRequestContext, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, data?: unknown, allow: number[] = []) {
  const res = await req.fetch(path, { method, data });
  if (!res.ok() && !allow.includes(res.status())) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return { status: res.status(), json: (await res.json().catch(() => ({}))) as T };
}

/** Deletes everything the run made: orgs (and their rows), then the accounts (their data cascades). */
export async function cleanup() {
  for (const slug of orgSlugs) {
    const { data } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
    if (!data) continue;
    await admin.from("usage_ledger").delete().eq("org_id", data.id);
    await admin.from("audit_logs").delete().eq("org_id", data.id);
    await admin.from("organizations").delete().eq("id", data.id);
  }
  for (const id of created) await admin.auth.admin.deleteUser(id);
}
