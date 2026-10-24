import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadInterview } from "./interviewContext";
import { memberContext } from "./orgContextServer";
import { checkAssignment, checkOrgPractice } from "./orgPractice";

// Stamping the org on a session (plans/m2-org.md O.4): once, on the first AI call, after the
// membership check; the browser's config can't move a session afterwards.

vi.mock("./orgPractice", () => ({ checkOrgPractice: vi.fn(async () => {}), checkAssignment: vi.fn(async () => {}) }));
vi.mock("./supabase-server", () => ({ getSupabaseForRequest: vi.fn() }));
vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock("./orgContextServer", () => ({ memberContext: vi.fn(async () => null) }));
vi.mock("./catalog-server", async () => {
  const { PACKS } = await import("./packs");
  return { getCatalog: async () => ({ packs: PACKS, domains: [] }) };
});

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const user = { id: "u1", email: "u1@college.edu" };

async function withSession(row: { orgId?: string; assignmentId?: string; stamped?: string | null; messages?: unknown[]; snapshot?: unknown }) {
  const updates: Record<string, unknown>[] = [];
  const { PACKS } = await import("./packs");
  const rows: Record<string, unknown> = {
    sessions: {
      data: { id: "s1", config: { packId: PACKS[0].id, persona: "neutral", durationMin: 15, ...(row.orgId ? { orgId: row.orgId } : {}), ...(row.assignmentId ? { assignmentId: row.assignmentId } : {}) }, messages: row.messages ?? [] },
      org_id: row.stamped ?? null,
      pack_snapshot: null,
      context_snapshot: row.snapshot ?? null,
      prompt_versions: null,
      model_ids: [],
    },
    profiles: { data: { name: "Asha", targetRole: "Backend Developer" } },
  };
  const query = (table: string) => {
    const q = { eq: () => q, maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) };
    return q;
  };
  const update = (r: Record<string, unknown>) => {
    updates.push(r);
    const q = { eq: () => q, then: (ok: (v: unknown) => void) => ok({ error: null }) };
    return q;
  };
  const { getSupabaseForRequest } = await import("./supabase-server");
  vi.mocked(getSupabaseForRequest).mockResolvedValue({ from: (t: string) => ({ select: () => query(t), update }) } as unknown as SupabaseClient);
  return updates;
}

const meta = { promptVersion: "v1", models: ["m"] };

beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.mocked(checkOrgPractice).mockClear();
  vi.mocked(checkAssignment).mockClear();
  vi.mocked(memberContext).mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("org stamping", () => {
  it("checks and stamps the requested org on the first call", async () => {
    const updates = await withSession({ orgId: ORG });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(checkOrgPractice).toHaveBeenCalledWith(user, ORG, expect.objectContaining({ id: expect.any(String) }));
    expect(ctx.orgId).toBe(ORG);
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).toMatchObject({ org_id: ORG });
  });

  it("solo practice stays solo", async () => {
    const updates = await withSession({});
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgId).toBeNull();
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).not.toHaveProperty("org_id");
    expect(checkOrgPractice).not.toHaveBeenCalled();
  });

  it("refuses to start when the check fails, and saves nothing", async () => {
    const updates = await withSession({ orgId: ORG });
    vi.mocked(checkOrgPractice).mockRejectedValueOnce(Object.assign(new Error("no"), { status: 403 }));
    await expect(loadInterview(user, "s1", undefined)).rejects.toMatchObject({ status: 403 });
    expect(updates).toEqual([]);
  });

  it("keeps the stamped org; a changed config can't move a session", async () => {
    await withSession({ orgId: OTHER, stamped: ORG, messages: [{ id: "m1", role: "interviewer", text: "Hi", at: 0 }] });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgId).toBe(ORG);
    expect(checkOrgPractice).not.toHaveBeenCalled();
  });

  it("never stamps a session that already started solo", async () => {
    const updates = await withSession({ orgId: ORG, messages: [{ id: "m1", role: "interviewer", text: "Hi", at: 0 }] });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgId).toBeNull();
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).not.toHaveProperty("org_id");
  });

  it("stamps an assignment with its org, after checking it", async () => {
    const A = "33333333-3333-3333-3333-333333333333";
    const updates = await withSession({ orgId: ORG, assignmentId: A });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(checkAssignment).toHaveBeenCalledWith(user, ORG, A, expect.anything());
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).toMatchObject({ org_id: ORG, assignment_id: A });
  });

  it("ignores an assignment without an org", async () => {
    const updates = await withSession({ assignmentId: "33333333-3333-3333-3333-333333333333" });
    const ctx = await loadInterview(user, "s1", undefined);
    await ctx.save({ code: "", call: "turn", meta });
    expect(checkAssignment).not.toHaveBeenCalled();
    expect(updates[0]).not.toHaveProperty("assignment_id");
  });
});

// The org's context for the interview, frozen when the session is stamped (plans/b2b-college.md B.8).
describe("org context", () => {
  const merged = { orgName: "Sunrise", companies: "TCS", roles: "", techStack: "Java", notes: "" };

  it("is read once with the stamp and saved on the session", async () => {
    vi.mocked(memberContext).mockResolvedValue(merged);
    const updates = await withSession({ orgId: ORG });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(memberContext).toHaveBeenCalledWith(expect.anything(), ORG, "u1");
    expect(ctx.orgContext).toEqual(merged);
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).toMatchObject({ org_id: ORG, context_snapshot: merged });
  });

  it("is never read again: a later call uses the frozen copy even if the org edits its context", async () => {
    vi.mocked(memberContext).mockResolvedValue({ ...merged, companies: "CHANGED" });
    await withSession({ orgId: ORG, stamped: ORG, snapshot: merged, messages: [{ id: "m1", role: "interviewer", text: "Hi", at: 0 }] });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgContext).toEqual(merged);
    expect(memberContext).not.toHaveBeenCalled();
  });

  it("stays empty for a session stamped when the org had no context, even if it adds some later", async () => {
    vi.mocked(memberContext).mockResolvedValue(merged);
    await withSession({ orgId: ORG, stamped: ORG, messages: [{ id: "m1", role: "interviewer", text: "Hi", at: 0 }] });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgContext).toBeNull();
  });

  it("records no context when the org has none", async () => {
    const updates = await withSession({ orgId: ORG });
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgContext).toBeNull();
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).toHaveProperty("context_snapshot", null);
  });

  it("solo practice carries none and never reads an org", async () => {
    const updates = await withSession({});
    const ctx = await loadInterview(user, "s1", undefined);
    expect(ctx.orgContext).toBeNull();
    expect(memberContext).not.toHaveBeenCalled();
    await ctx.save({ code: "", call: "turn", meta });
    expect(updates[0]).not.toHaveProperty("context_snapshot");
  });
});
