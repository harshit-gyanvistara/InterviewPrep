import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_USER, type AuthUser } from "./auth";
import { periodWindow, type Meter } from "./packages";
import { addUsage, checkEntitlement, packageFor, requireAllowance, type UsageStore } from "./policies";
import { getSupabaseAdmin } from "./supabase";
import { getSupabaseForRequest } from "./supabase-server";

// Usage allowances by package (plans/usage-limits.md).

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./supabase-server", async (orig) => ({ ...(await orig<typeof import("./supabase-server")>()), getSupabaseForRequest: vi.fn() }));

const user: AuthUser = { id: "22222222-2222-2222-2222-222222222222", email: "asha@example.com" };

/** The ledger as an array, with the same total/add contract as usage_ledger. */
function memoryLedger() {
  const rows: { userId: string; meter: Meter; amount: number; at: number }[] = [];
  const store: UsageStore = {
    async total(userId, meter, sinceMs) {
      return rows.filter((r) => r.userId === userId && r.meter === meter && r.at >= sinceMs).reduce((s, r) => s + r.amount, 0);
    },
    async add({ userId, meter, amount }) {
      rows.push({ userId, meter, amount, at: Date.now() });
    },
  };
  return { rows, store };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("periodWindow (India time)", () => {
  it("starts a day at midnight IST and resets at the next one", () => {
    // 2026-10-19 23:30 IST = 18:00 UTC
    const w = periodWindow("day", Date.UTC(2026, 9, 19, 18, 0));
    expect(new Date(w.startsAt).toISOString()).toBe("2026-10-18T18:30:00.000Z");
    expect(new Date(w.resetsAt!).toISOString()).toBe("2026-10-19T18:30:00.000Z");
  });

  it("starts a month on the 1st IST", () => {
    const w = periodWindow("month", Date.UTC(2026, 9, 31, 20, 0)); // 1 Nov 01:30 IST
    expect(new Date(w.startsAt).toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });

  it("never resets for 'none'", () => {
    expect(periodWindow("none")).toEqual({ startsAt: 0, resetsAt: null });
  });
});

describe("packages", () => {
  it("puts everyone on beta unless PACKAGE_DEFAULT names another package", () => {
    expect(packageFor(user)).toBe("beta");
    vi.stubEnv("PACKAGE_DEFAULT", "pro");
    expect(packageFor(user)).toBe("pro");
    vi.stubEnv("PACKAGE_DEFAULT", "nonsense");
    expect(packageFor(user)).toBe("beta");
  });
});

describe("checkEntitlement / requireAllowance", () => {
  it("allows up to the beta limit of 5 mocks a day, then refuses with the reset time", async () => {
    const { store } = memoryLedger();
    for (let i = 0; i < 5; i++) {
      await requireAllowance(user, "mocks", store);
      await addUsage(user, "mocks", { store });
    }
    const s = await checkEntitlement(user, "mocks", store);
    expect(s).toMatchObject({ used: 5, limit: 5, allowed: false });
    await expect(requireAllowance(user, "mocks", store)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/all 5 mock interviews for today/) });
  });

  it("counts meters separately and per user", async () => {
    const { store } = memoryLedger();
    await addUsage(user, "ai_calls", { amount: 150, store });
    expect((await checkEntitlement(user, "ai_calls", store)).allowed).toBe(false);
    expect((await checkEntitlement(user, "mocks", store)).allowed).toBe(true);
    expect((await checkEntitlement({ id: "other", email: null }, "ai_calls", store)).allowed).toBe(true);
  });

  it("starts fresh in a new period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 19, 10));
    const { store } = memoryLedger();
    await addUsage(user, "mocks", { amount: 5, store });
    expect((await checkEntitlement(user, "mocks", store)).allowed).toBe(false);
    vi.setSystemTime(Date.UTC(2026, 9, 20, 10));
    expect((await checkEntitlement(user, "mocks", store)).allowed).toBe(true);
  });

  it("treats an unlimited allowance as always allowed", async () => {
    vi.stubEnv("PACKAGE_DEFAULT", "pro");
    const { store } = memoryLedger();
    await addUsage(user, "mocks", { amount: 1000, store });
    expect(await checkEntitlement(user, "mocks", store)).toMatchObject({ limit: null, allowed: true });
  });

  it("never limits or records the local user (AUTH_MODE=off)", async () => {
    const { rows, store } = memoryLedger();
    await addUsage(LOCAL_USER, "mocks", { amount: 99, store });
    expect(rows).toHaveLength(0);
    expect((await checkEntitlement(LOCAL_USER, "mocks", store)).allowed).toBe(true);
  });

  it("fails open, logged, when the ledger is down; recording never throws", async () => {
    const broken: UsageStore = { total: async () => Promise.reject(new Error("down")), add: async () => Promise.reject(new Error("down")) };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkEntitlement(user, "mocks", broken)).allowed).toBe(true);
    await expect(addUsage(user, "mocks", { store: broken })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe("routes", () => {
  // A fake secret-key client whose ledger already holds `used` mocks for today.
  function ledgerWith(used: number) {
    const inserts: unknown[] = [];
    const admin = {
      rpc: vi.fn(async (_fn: string, args: { p_meter: string }) => ({ data: args.p_meter === "mocks" ? used : 0, error: null })),
      from: vi.fn(() => ({ insert: vi.fn(async (row: unknown) => (inserts.push(row), { error: null })) })),
    };
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as unknown as SupabaseClient);
    return { admin, inserts };
  }

  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("LIVE_AGENT_URL", "http://agent.test");
    vi.mocked(getSupabaseForRequest).mockResolvedValue({
      auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: user.id, email: user.email } }, error: null })) },
    } as unknown as SupabaseClient);
  });

  afterEach(() => vi.mocked(getSupabaseAdmin).mockReturnValue(null));

  const turnBody = (messages: unknown[]) => ({
    config: { packId: "behavioural", persona: "neutral", durationMin: 15 },
    profile: { name: "Asha", targetRole: "Backend Developer" },
    pack: { id: "behavioural", title: "B", company: "Any", role: "Any", roundType: "behavioural", description: "d", durationMin: 15, topics: ["t"], rubric: ["r"], style: "s" },
    messages,
  });
  const post = (body: unknown) =>
    new Request("http://localhost/api/interview/turn", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });

  it("refuses to start a 6th mock, but lets a mock already under way continue", async () => {
    ledgerWith(5);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ reply: "Next question", done: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("../app/api/interview/turn/route");

    const start = await POST(post(turnBody([])));
    expect(start.status).toBe(429);
    expect((await start.json()).error).toMatch(/all 5 mock interviews for today/);
    expect(fetchSpy).not.toHaveBeenCalled();

    const ongoing = await POST(post(turnBody([{ role: "interviewer", text: "Hi", ts: 1 }, { role: "candidate", text: "Hello", ts: 2 }])));
    expect(ongoing.status).toBe(200);
  });

  it("records an AI call in the ledger with its request id", async () => {
    const { inserts } = ledgerWith(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "Hi", done: false }), { status: 200 })));
    const { POST } = await import("../app/api/interview/turn/route");
    expect((await POST(post(turnBody([])))).status).toBe(200);
    expect(inserts).toEqual([expect.objectContaining({ user_id: user.id, meter: "ai_calls", amount: 1, request_id: expect.any(String) })]);
  });
});
