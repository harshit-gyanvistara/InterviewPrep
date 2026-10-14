import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKS } from "./packs";
import { RATE_LIMITS, type Bucket } from "./rateLimit";

// Contract tests for the Core API routes (implementationPlan M1.6). liveAgent is mocked at the
// fetch level, so these exercise the real route → parseBody → rateLimit → callAgent → errorResponse
// path: what each route sends to liveAgent, and how every failure reaches the browser.

const AGENT = "http://agent.test";
const pack = PACKS[0];
const profile = { id: "me", name: "Asha", targetRole: "Backend Developer", targetCompanies: "Acme", jobDescription: "Go services", experience: "1-3y", resume: "", onboarded: true, createdAt: 1 };
const config = { packId: pack.id, persona: "tough", durationMin: 30, pressure: false };
const messages = [
  { id: "1", role: "interviewer", text: "Tell me about yourself.", at: 0 },
  { id: "2", role: "candidate", text: "I build APIs.", at: 5000 },
];

interface Case {
  name: string;
  bucket: Bucket;
  agentPath: string;
  load: () => Promise<{ POST: (req: Request) => Promise<Response> }>;
  body: unknown;
  /** Checks the request body this route sent to liveAgent. */
  sent: (body: Record<string, unknown>) => void;
}

const cases: Case[] = [
  {
    name: "interview/turn",
    bucket: "interview.turn",
    agentPath: "/v1/interview/turn",
    load: () => import("../app/api/interview/turn/route"),
    body: { config, profile, pack, messages, elapsedSec: 42, code: "" },
    sent: (b) => {
      expect(b.persona).toMatchObject({ name: expect.any(String), tone: expect.any(String) });
      expect(b.domain).toMatchObject({ id: "software" });
      expect(b.profile).not.toHaveProperty("id");
      expect(b.messages).toEqual([
        { role: "interviewer", text: "Tell me about yourself." },
        { role: "candidate", text: "I build APIs." },
      ]);
      expect(b.elapsedSec).toBe(42);
    },
  },
  {
    name: "interview/report",
    bucket: "interview.report",
    agentPath: "/v1/interview/report",
    load: () => import("../app/api/interview/report/route"),
    body: { config, profile, pack, messages, code: "" },
    sent: (b) => {
      expect(b.interviewerName).toEqual(expect.any(String));
      expect(b.domain).toMatchObject({ id: "software" });
      expect(b).not.toHaveProperty("persona");
    },
  },
  {
    name: "pack/generate",
    bucket: "pack.generate",
    agentPath: "/v1/packs/generate",
    load: () => import("../app/api/pack/generate/route"),
    body: { profile },
    sent: (b) => {
      expect(Object.keys(b).sort()).toEqual(["domain", "profile"]);
      expect(b.profile).toMatchObject({ targetRole: "Backend Developer" });
    },
  },
  {
    name: "roadmap",
    bucket: "roadmap",
    agentPath: "/v1/roadmap",
    load: () => import("../app/api/roadmap/route"),
    body: { profile, weeks: 4, digests: [{ overall: 60 }] },
    sent: (b) => {
      expect(b.weeks).toBe(4);
      expect(b.digests).toEqual([{ overall: 60 }]);
    },
  },
  {
    name: "ai/assist",
    bucket: "ai.assist",
    agentPath: "/v1/assist",
    load: () => import("../app/api/ai/assist/route"),
    body: { mode: "improve", text: "rough notes" },
    sent: (b) => expect(b).toEqual({ mode: "improve", text: "rough notes" }),
  },
];

// Each test gets its own client IP, so the module-level in-memory rate limiter never leaks between tests.
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

const post = (body: unknown, ip: string) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const agentReply = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.stubEnv("LIVE_AGENT_URL", AGENT);
  vi.stubEnv("LIVE_AGENT_TOKEN", "agent-token");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(cases)("POST /api/$name", ({ bucket, agentPath, load, body, sent }) => {
  it("sends the shaped request to liveAgent and returns its JSON unchanged", async () => {
    const fetchSpy = agentReply(200, { ok: "from agent" });
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await load();

    const res = await POST(post(body, nextIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: "from agent" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(AGENT + agentPath);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer agent-token");
    sent(JSON.parse(String(init.body)));
  });

  it.each([400, 422, 502])("passes a liveAgent %i through with its message", async (status) => {
    vi.stubGlobal("fetch", agentReply(status, { error: `agent said ${status}` }));
    const { POST } = await load();

    const res = await POST(post(body, nextIp()));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: `agent said ${status}` });
  });

  it("returns 503 when liveAgent is unreachable or not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { POST } = await load();
    const down = await POST(post(body, nextIp()));
    expect(down.status).toBe(503);
    expect((await down.json()).error).toMatch(/unreachable/);

    vi.stubEnv("LIVE_AGENT_URL", "");
    const unset = await POST(post(body, nextIp()));
    expect(unset.status).toBe(503);
    expect((await unset.json()).error).toMatch(/LIVE_AGENT_URL/);
  });

  it("returns 504 when liveAgent times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    const { POST } = await load();
    const res = await POST(post(body, nextIp()));
    expect(res.status).toBe(504);
  });

  it("returns 429 with Retry-After once the client is over the limit, without calling liveAgent", async () => {
    const fetchSpy = agentReply(200, {});
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await load();
    const ip = nextIp();
    const { limit } = RATE_LIMITS[bucket];

    for (let i = 0; i < limit; i++) expect((await POST(post(body, ip))).status).toBe(200);
    const res = await POST(post(body, ip));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/Too many requests/);
    expect(fetchSpy).toHaveBeenCalledTimes(limit);
  });
});

describe("GET /api/health", () => {
  const get = (ip: string) => new Request("http://localhost/api/health", { headers: { "x-forwarded-for": ip } });

  it("returns liveAgent's model check", async () => {
    const fetchSpy = agentReply(200, { ok: true, hasKey: true });
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("../app/api/health/route");

    const res = await GET(get(nextIp()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, hasKey: true });
    const [url] = fetchSpy.mock.calls[0] as unknown as [URL];
    expect(String(url)).toBe(`${AGENT}/v1/health/models`);
  });

  it("reports failures in the health shape, keeping the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { GET } = await import("../app/api/health/route");

    const res = await GET(get(nextIp()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, hasKey: false, error: expect.stringMatching(/unreachable/) });
  });
});
