import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse } from "./liveAgent";
import { parseBody } from "./route";
import { LIMITS } from "./schemas";

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

const Schema = z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const e = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe("parseBody", () => {
  it("returns parsed data with defaults applied and unknown keys stripped", async () => {
    await expect(parseBody(request(JSON.stringify({ name: "a", extra: 1 })), Schema)).resolves.toEqual({ name: "a", tags: [] });
  });

  it("rejects invalid JSON with 400", async () => {
    const e = await failure(parseBody(request("{nope"), Schema));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/valid JSON/);
  });

  it("rejects a schema mismatch with 400, naming the field and listing every issue", async () => {
    const e = await failure(parseBody(request(JSON.stringify({ name: "", tags: [1] })), Schema));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/^Invalid request: name: /);
    expect(e.issues?.map((i) => i.path)).toEqual(["name", "tags.0"]);
  });

  it("uses a custom rule's message as-is", async () => {
    const Custom = z.object({ a: z.string() }).refine((b) => b.a === "ok", { message: "Say ok." });
    const e = await failure(parseBody(request(JSON.stringify({ a: "no" })), Custom));
    expect(e.message).toBe("Say ok.");
  });

  it("rejects bodies over the size limit with 413, by header or by actual size", async () => {
    const byHeader = await failure(parseBody(request("{}", { "content-length": String(LIMITS.bodyBytes + 1) }), Schema));
    expect(byHeader.status).toBe(413);

    const big = JSON.stringify({ name: "x".repeat(LIMITS.bodyBytes) });
    const bySize = await failure(parseBody(request(big), Schema));
    expect(bySize.status).toBe(413);
  });
});

describe("errorResponse", () => {
  it("includes issues only when there are some", async () => {
    const withIssues = errorResponse(new ApiError(400, "bad", [{ path: "a", message: "m" }]));
    expect(withIssues.status).toBe(400);
    expect(await withIssues.json()).toEqual({ error: "bad", issues: [{ path: "a", message: "m" }] });

    const plain = errorResponse(new ApiError(502, "upstream"));
    expect(await plain.json()).toEqual({ error: "upstream" });

    const unknown = errorResponse(new Error("boom"));
    expect(unknown.status).toBe(500);
  });
});

describe("routes reject bad input before calling liveAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["interview/turn", () => import("../app/api/interview/turn/route")],
    ["interview/report", () => import("../app/api/interview/report/route")],
    ["pack/generate", () => import("../app/api/pack/generate/route")],
    ["roadmap", () => import("../app/api/roadmap/route")],
    ["ai/assist", () => import("../app/api/ai/assist/route")],
  ])("%s", async (_, load) => {
    vi.stubEnv("LIVE_AGENT_URL", "http://agent.test");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await load();

    // Invalid for every route: profile must be an object, assist needs a mode.
    const res = await POST(request(JSON.stringify({ profile: "me" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
