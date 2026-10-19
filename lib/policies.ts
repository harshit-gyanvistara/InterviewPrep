import { LOCAL_USER, type AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { periodWindow, type Allowance, type Meter } from "./packages";
import { getPackages } from "./packages-server";
import { getSupabaseAdmin } from "./supabase";

// Server-only. Usage allowances (plans/usage-limits.md). Each business decision is one function
// here (D15): who is on which package, and whether a user may use a meter right now. Use is
// recorded in the `usage_ledger` table and allowances are checked by summing it.

/**
 * The package a user is on: PACKAGE_DEFAULT when it names an active package, else beta.
 * M6 reads the user's subscription; O.5 checks their org's entitlements first.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the user decides the package from M6 on
export async function packageFor(user: AuthUser): Promise<string> {
  const configured = process.env.PACKAGE_DEFAULT?.trim();
  return configured && configured in (await getPackages()) ? configured : "beta";
}

async function allowanceFor(user: AuthUser, meter: Meter): Promise<Allowance | undefined> {
  return (await getPackages())[await packageFor(user)]?.[meter];
}

/** Where use is recorded. The ledger in production; tests pass an in-memory one. */
export interface UsageStore {
  total(userId: string, meter: Meter, sinceMs: number): Promise<number>;
  add(row: { userId: string; meter: Meter; amount: number; requestId?: string; orgId?: string | null }): Promise<void>;
}

/** The `usage_ledger` table via the secret-key client; null without SUPABASE_SECRET_KEY (local dev). */
export function ledgerStore(): UsageStore | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return {
    async total(userId, meter, sinceMs) {
      const { data, error } = await db.rpc("usage_total", { p_user: userId, p_meter: meter, p_since: new Date(sinceMs).toISOString() });
      if (error) throw new Error(`usage_total failed: ${error.message}`);
      return Number(data ?? 0);
    },
    async add({ userId, meter, amount, requestId, orgId }) {
      const { error } = await db.from("usage_ledger").insert({ user_id: userId, meter, amount, request_id: requestId ?? null, org_id: orgId ?? null });
      if (error) throw new Error(`usage_ledger insert failed: ${error.message}`);
    },
  };
}

export interface MeterStatus {
  meter: Meter;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** Epoch ms when the count resets; null when it never does. */
  resetsAt: number | null;
  allowed: boolean;
}

const logError = (meter: Meter, e: unknown) =>
  console.error(JSON.stringify({ event: "usage.error", meter, error: e instanceof Error ? e.message : String(e) }));

/** Where the user stands on `meter`. Fails open (logged) if the ledger can't be read. */
export async function checkEntitlement(user: AuthUser, meter: Meter, store: UsageStore | null = ledgerStore()): Promise<MeterStatus> {
  const allowance = await allowanceFor(user, meter);
  if (user === LOCAL_USER || !allowance || allowance.limit === null) {
    return { meter, used: 0, limit: null, resetsAt: null, allowed: true };
  }
  const { startsAt, resetsAt } = periodWindow(allowance.period);
  let used = 0;
  try {
    used = store ? await store.total(user.id, meter, startsAt) : 0;
  } catch (e) {
    logError(meter, e);
  }
  return { meter, used, limit: allowance.limit, resetsAt, allowed: used < allowance.limit };
}

const NOUN: Record<Meter, string> = { mocks: "mock interviews", ai_calls: "AI requests" };

function resetText(resetsAt: number | null): string {
  if (resetsAt === null) return "";
  const soon = resetsAt - Date.now() < 26 * 3600 * 1000;
  const when = new Date(resetsAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(soon ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" }),
  });
  return soon ? ` They reset at ${when} IST.` : ` They reset on ${when}.`;
}

/** Throws ApiError 429 when the user has used up `meter` for this period. */
export async function requireAllowance(user: AuthUser, meter: Meter, store?: UsageStore | null): Promise<void> {
  const s = await checkEntitlement(user, meter, store === undefined ? ledgerStore() : store);
  if (s.allowed) return;
  console.warn(JSON.stringify({ event: "usage.blocked", meter, userId: user.id, used: s.used, limit: s.limit }));
  const retryAfterSec = s.resetsAt ? Math.max(1, Math.ceil((s.resetsAt - Date.now()) / 1000)) : undefined;
  if (s.limit === 0) throw new ApiError(403, `${NOUN[meter][0].toUpperCase()}${NOUN[meter].slice(1)} aren't included in your plan.`);
  const span = (await allowanceFor(user, meter))?.period === "month" ? "this month" : "today";
  throw new ApiError(429, `You've used all ${s.limit} ${NOUN[meter]} for ${span}.${resetText(s.resetsAt)}`, { retryAfterSec });
}

/** Records use of `meter`. Never throws: recording must not fail the user's request. */
export async function addUsage(
  user: AuthUser,
  meter: Meter,
  { amount = 1, requestId, orgId, store = ledgerStore() }: { amount?: number; requestId?: string; orgId?: string | null; store?: UsageStore | null } = {},
): Promise<void> {
  if (user === LOCAL_USER || !store) return;
  try {
    await store.add({ userId: user.id, meter, amount, requestId, orgId });
  } catch (e) {
    logError(meter, e);
  }
}

// ---- Organisations (plans/org-ready-schema.md) ----

/** An org's plan and use, for org quotas (plans/m2-org.md O.4). The database in production; tests pass an in-memory one. */
export interface OrgUsageStore {
  /** The org's `entitlements` row for this meter, or null when it has none (= unlimited). */
  allowance(orgId: string, meter: Meter): Promise<{ limit: number | null; period: string } | null>;
  /** Use of the meter by everyone practising for the org since a time. */
  total(orgId: string, meter: Meter, sinceMs: number): Promise<number>;
}

export function orgUsageStore(): OrgUsageStore | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return {
    async allowance(orgId, meter) {
      const { data, error } = await db.from("entitlements").select("limit, period").eq("org_id", orgId).eq("key", meter).maybeSingle();
      if (error) throw new Error(`entitlements read failed: ${error.message}`);
      return data;
    },
    async total(orgId, meter, sinceMs) {
      const { data, error } = await db.rpc("usage_total_org", { p_org: orgId, p_meter: meter, p_since: new Date(sinceMs).toISOString() });
      if (error) throw new Error(`usage_total_org failed: ${error.message}`);
      return Number(data ?? 0);
    },
  };
}

const IST_MS = 5.5 * 3600 * 1000;

/** Like periodWindow, plus "year" (org plans can be yearly). */
function orgWindow(period: string, now = Date.now()): { startsAt: number; resetsAt: number | null } {
  if (period !== "year") return periodWindow(period === "day" || period === "month" ? period : "none", now);
  const y = new Date(now + IST_MS).getUTCFullYear();
  return { startsAt: Date.UTC(y, 0, 1) - IST_MS, resetsAt: Date.UTC(y + 1, 0, 1) - IST_MS };
}

/** Where an org stands on `meter`. No entitlement row = unlimited. Fails open (logged) if the database can't be read. */
export async function checkOrgEntitlement(orgId: string, meter: Meter, store: OrgUsageStore | null = orgUsageStore()): Promise<MeterStatus> {
  const open: MeterStatus = { meter, used: 0, limit: null, resetsAt: null, allowed: true };
  if (!store) return open;
  try {
    const allowance = await store.allowance(orgId, meter);
    if (!allowance || allowance.limit === null) return open;
    const { startsAt, resetsAt } = orgWindow(allowance.period);
    const used = await store.total(orgId, meter, startsAt);
    return { meter, used, limit: allowance.limit, resetsAt, allowed: used < allowance.limit };
  } catch (e) {
    logError(meter, e);
    return open;
  }
}

const SPAN: Record<string, string> = { day: " today", month: " this month", year: " this year", none: "" };

/** Throws ApiError 429 (403 when the plan includes none) when the org has used up `meter` (decision G3: org practice uses the org's plan). */
export async function requireOrgAllowance(orgId: string, meter: Meter, store: OrgUsageStore | null = orgUsageStore()): Promise<void> {
  const s = await checkOrgEntitlement(orgId, meter, store);
  if (s.allowed) return;
  console.warn(JSON.stringify({ event: "usage.blocked", meter, orgId, used: s.used, limit: s.limit }));
  if (s.limit === 0) throw new ApiError(403, `Your organisation's plan doesn't include ${NOUN[meter]}. Practise as yourself, or ask your admin.`);
  const period = store ? ((await store.allowance(orgId, meter).catch(() => null))?.period ?? "none") : "none";
  const retryAfterSec = s.resetsAt ? Math.max(1, Math.ceil((s.resetsAt - Date.now()) / 1000)) : undefined;
  throw new ApiError(429, `Your organisation has used all ${s.limit} ${NOUN[meter]}${SPAN[period] ?? ""}.${resetText(s.resetsAt)} You can still practise as yourself.`, { retryAfterSec });
}

export { DEFAULT_ORG_SETTINGS, orgSettings, type OrgSettings } from "./orgSettings";

/**
 * Does this user need a guardian's consent to practise under this org? Always false until the
 * minors decision is made (plans/organisations.md § Deferred decisions); then it reads
 * `users.birth_year` and the org's region, and callers don't change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- decided later (D15)
export function requiresGuardianConsent(user: AuthUser, org: { id: string }): boolean {
  return false;
}
