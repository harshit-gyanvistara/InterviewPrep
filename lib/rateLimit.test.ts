import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorResponse } from "./liveAgent";
import { RATE_LIMITS, clientIp, enforceRateLimit, memoryStore, upstashStore, type LimiterStore } from "./rateLimit";

const rule = { limit: 3, windowSec: 60 };
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { method: "POST", headers });

describe("memoryStore", () => {
  it("allows up to the limit in a window, then blocks until it resets", async () => {
    let t = 1_000_000;
    const store = memoryStore(() => t);
    for (let i = 0; i < 3; i++) expect((await store.hit("k", rule)).allowed).toBe(true);

    t += 20_000;
    expect(await store.hit("k", rule)).toEqual({ allowed: false, retryAfterSec: 40 });

    t += 40_000;
    expect((await store.hit("k", rule)).allowed).toBe(true);
  });

  it("counts keys separately", async () => {
    const store = memoryStore(() => 0);
    for (let i = 0; i < 3; i++) await store.hit("a", rule);
    expect((await store.hit("a", rule)).allowed).toBe(false);
    expect((await store.hit("b", rule)).allowed).toBe(true);
  });
});

describe("upstashStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("sends one pipeline that creates the window, counts, and reads the TTL", async () => {
    const fetchMock = reply([{ result: "OK" }, { result: 1 }, { result: 60 }]);
    vi.stubGlobal("fetch", fetchMock);

    expect(await upstashStore("https://redis.test/", "tok").hit("turn:1.2.3.4", rule)).toEqual({ allowed: true, retryAfterSec: 60 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://redis.test/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual([
      ["SET", "offerly:rl:turn:1.2.3.4", "0", "EX", "60", "NX"],
      ["INCR", "offerly:rl:turn:1.2.3.4"],
      ["TTL", "offerly:rl:turn:1.2.3.4"],
    ]);
  });

  it("blocks once the count passes the limit, with the key's remaining TTL", async () => {
    vi.stubGlobal("fetch", reply([{ result: null }, { result: 4 }, { result: 17 }]));
    expect(await upstashStore("https://redis.test", "tok").hit("k", rule)).toEqual({ allowed: false, retryAfterSec: 17 });
  });

  it("throws on an HTTP error or a command error", async () => {
    vi.stubGlobal("fetch", reply({ error: "unauthorized" }, 401));
    await expect(upstashStore("https://redis.test", "bad").hit("k", rule)).rejects.toThrow(/401/);

    vi.stubGlobal("fetch", reply([{ error: "WRONGTYPE" }, { result: 1 }, { result: 60 }]));
    await expect(upstashStore("https://redis.test", "tok").hit("k", rule)).rejects.toThrow(/WRONGTYPE/);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry, then x-real-ip, then a shared fallback", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lets requests through up to the bucket's limit, then throws 429 with Retry-After", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore(() => 0);
    const from = req({ "x-forwarded-for": "203.0.113.7" });
    const { limit } = RATE_LIMITS["interview.report"];
    for (let i = 0; i < limit; i++) await enforceRateLimit(from, "interview.report", { store });

    const e = await enforceRateLimit(from, "interview.report", { store }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 429, retryAfterSec: 600, message: "Too many requests. Try again in 10 minutes." });

    const res = errorResponse(e);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
  });

  it("keeps buckets and IPs apart", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore(() => 0);
    const a = req({ "x-forwarded-for": "203.0.113.7" });
    for (let i = 0; i < RATE_LIMITS.health.limit; i++) await enforceRateLimit(a, "health", { store });
    await expect(enforceRateLimit(a, "health", { store })).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/seconds\.$/) });

    await expect(enforceRateLimit(a, "interview.turn", { store })).resolves.toBeUndefined();
    await expect(enforceRateLimit(req({ "x-forwarded-for": "198.51.100.2" }), "health", { store })).resolves.toBeUndefined();
  });

  it("counts a signed-in user across IPs, separately from anonymous traffic on the same IP", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore(() => 0);
    const { limit } = RATE_LIMITS.health;
    for (let i = 0; i < limit; i++) await enforceRateLimit(req({ "x-forwarded-for": `203.0.113.${i}` }), "health", { userId: "u1", store });
    await expect(enforceRateLimit(req({ "x-forwarded-for": "203.0.113.99" }), "health", { userId: "u1", store })).rejects.toMatchObject({ status: 429 });

    await expect(enforceRateLimit(req({ "x-forwarded-for": "203.0.113.0" }), "health", { store })).resolves.toBeUndefined();
    await expect(enforceRateLimit(req(), "health", { userId: "u2", store })).resolves.toBeUndefined();
  });

  it("fails open and logs when the store errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: LimiterStore = { hit: async () => Promise.reject(new Error("redis down")) };
    await expect(enforceRateLimit(req(), "interview.turn", { store: broken })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("redis down"));
  });
});

describe("routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("report returns 429 once an IP is over its limit, without calling liveAgent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("../app/api/interview/report/route");
    const call = () => POST(new Request("http://localhost/api/interview/report", { method: "POST", headers: { "x-forwarded-for": "192.0.2.99" }, body: "{}" }));

    // Invalid bodies still count: the limit applies before validation.
    for (let i = 0; i < RATE_LIMITS["interview.report"].limit; i++) expect((await call()).status).toBe(400);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
