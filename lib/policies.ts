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
  add(row: { userId: string; meter: Meter; amount: number; requestId?: string }): Promise<void>;
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
    async add({ userId, meter, amount, requestId }) {
      const { error } = await db.from("usage_ledger").insert({ user_id: userId, meter, amount, request_id: requestId ?? null });
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
  const span = (await allowanceFor(user, meter))?.period === "month" ? "this month" : "today";
  throw new ApiError(429, `You've used all ${s.limit} ${NOUN[meter]} for ${span}.${resetText(s.resetsAt)}`, { retryAfterSec });
}

/** Records use of `meter`. Never throws: recording must not fail the user's request. */
export async function addUsage(
  user: AuthUser,
  meter: Meter,
  { amount = 1, requestId, store = ledgerStore() }: { amount?: number; requestId?: string; store?: UsageStore | null } = {},
): Promise<void> {
  if (user === LOCAL_USER || !store) return;
  try {
    await store.add({ userId: user.id, meter, amount, requestId });
  } catch (e) {
    logError(meter, e);
  }
}
