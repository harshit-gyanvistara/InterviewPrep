import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicPath } from "../proxy";
import { LOCAL_USER, TERMS_VERSION, authMode, getUser, googleEnabled, requireUser } from "./auth";
import { isInApp } from "./inApp";
import { PACKS } from "./packs";
import { redirectFor } from "./pages";
import { RATE_LIMITS } from "./rateLimit";
import { getSupabaseAdmin } from "./supabase";
import { getSupabaseForRequest } from "./supabase-server";
import { ensureTermsConsent, listItems, putItem, removeItems } from "./userData";

// Accounts (plans/auth.md): auth modes, the 401 on every AI route, the sign-in and storage routes.
// Supabase is faked at the client level; the RLS isolation tests against a real database live in
// supabase/tests/.

vi.mock("./supabase-server", async (orig) => ({ ...(await orig<typeof import("./supabase-server")>()), getSupabaseForRequest: vi.fn() }));
vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));
vi.mock("./userData", async (orig) => ({
  ...(await orig<typeof import("./userData")>()),
  listItems: vi.fn(async () => []),
  putItem: vi.fn(async () => {}),
  removeItems: vi.fn(async () => {}),
  ensureTermsConsent: vi.fn(async () => {}),
}));

const USER_ID = "11111111-1111-1111-1111-111111111111";

/** The parts of a Supabase client the app uses for auth; `sub` = who the session cookie belongs to. */
function fakeClient(sub?: string) {
  return {
    auth: {
      getClaims: vi.fn(async () => ({ data: sub ? { claims: { sub, email: "asha@example.com" } } : null, error: null })),
      signInWithOtp: vi.fn<(arg: unknown) => Promise<{ error: null | { status: number; code: string } }>>(async () => ({ error: null })),
      verifyOtp: vi.fn<(arg: unknown) => Promise<{ data: { user: { id: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      exchangeCodeForSession: vi.fn<(code: string) => Promise<{ data: { user: { id: string; email?: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      signOut: vi.fn<(arg?: unknown) => Promise<{ error: null }>>(async () => ({ error: null })),
    },
  };
}

function signedInAs(sub?: string) {
  const client = fakeClient(sub);
  vi.mocked(getSupabaseForRequest).mockResolvedValue(client as unknown as SupabaseClient);
  return client;
}

let ipCounter = 0;
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${++ipCounter % 250}` },
    body: JSON.stringify(body),
  });
const ctx = (collection: string) => ({ params: Promise.resolve({ collection }) });

function accountsOn() {
  vi.stubEnv("AUTH_MODE", "");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("LIVE_AGENT_URL", "http://agent.test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("auth mode", () => {
  it("is off without Supabase config and on with it; AUTH_MODE overrides", () => {
    expect(authMode()).toBe("off");
    accountsOn();
    expect(authMode()).toBe("supabase");
    vi.stubEnv("AUTH_MODE", "off");
    expect(authMode()).toBe("off");
  });

  it("offers Google only when accounts are on and AUTH_GOOGLE=on", () => {
    vi.stubEnv("AUTH_GOOGLE", "on");
    expect(googleEnabled()).toBe(false);
    accountsOn();
    expect(googleEnabled()).toBe(true);
    vi.stubEnv("AUTH_GOOGLE", "");
    expect(googleEnabled()).toBe(false);
  });

  it("off: everyone is the local user, except in production, where it fails closed", async () => {
    await expect(getUser()).resolves.toBe(LOCAL_USER);
    vi.stubEnv("NODE_ENV", "production");
    await expect(getUser()).rejects.toMatchObject({ status: 503 });
  });

  it("AUTH_MODE=supabase without the keys is a 503, not an open door", async () => {
    vi.stubEnv("AUTH_MODE", "supabase");
    await expect(requireUser()).rejects.toMatchObject({ status: 503 });
  });

  it("supabase: the user comes from the verified session claims", async () => {
    accountsOn();
    signedInAs(USER_ID);
    await expect(requireUser()).resolves.toEqual({ id: USER_ID, email: "asha@example.com" });

    signedInAs(undefined);
    await expect(getUser()).resolves.toBeNull();
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
});

describe("AI routes require a signed-in user", () => {
  const pack = PACKS[0];
  const profile = { name: "Asha", targetRole: "Backend Developer" };
  const config = { persona: "neutral", durationMin: 30 };

  it.each([
    ["interview/turn", () => import("../app/api/interview/turn/route"), { config, profile, pack }],
    ["interview/report", () => import("../app/api/interview/report/route"), { config, profile, pack }],
    ["pack/generate", () => import("../app/api/pack/generate/route"), { profile }],
    ["roadmap", () => import("../app/api/roadmap/route"), { profile }],
    ["ai/assist", () => import("../app/api/ai/assist/route"), { mode: "improve", text: "x" }],
  ] as const)("%s returns 401 without a session and never calls liveAgent", async (_, load, body) => {
    accountsOn();
    signedInAs(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await load();

    const res = await POST(json(body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to continue." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("health returns 401 in its own shape", async () => {
    accountsOn();
    signedInAs(undefined);
    const { GET } = await import("../app/api/health/route");
    const res = await GET(json(undefined, "GET"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: "Sign in to continue." });
  });

  it("returns 403 to a signed-in user who isn't on the beta list", async () => {
    accountsOn();
    vi.stubEnv("BETA_ALLOWED_EMAILS", "someone@else.com");
    signedInAs("beta-outsider");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("../app/api/ai/assist/route");
    const res = await POST(json({ mode: "improve", text: "x" }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rate-limits a signed-in user across IPs", async () => {
    accountsOn();
    signedInAs("rate-limit-user");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { POST } = await import("../app/api/ai/assist/route");
    const body = { mode: "improve", text: "x" };

    // json() gives every request a different IP.
    for (let i = 0; i < RATE_LIMITS["ai.assist"].limit; i++) expect((await POST(json(body))).status).toBe(200);
    expect((await POST(json(body))).status).toBe(429);
  });
});

describe("GET /api/auth/me", () => {
  it("reports the mode and the user", async () => {
    const { GET } = await import("../app/api/auth/me/route");
    expect(await (await GET()).json()).toEqual({ mode: "off", user: LOCAL_USER, google: false });

    accountsOn();
    signedInAs(undefined);
    expect(await (await GET()).json()).toEqual({ mode: "supabase", user: null, google: false });
  });
});

describe("email sign-in", () => {
  it("is a 404 when accounts are off", async () => {
    const otp = await import("../app/api/auth/otp/route");
    const verify = await import("../app/api/auth/verify/route");
    expect((await otp.POST(json({ email: "a@b.co" }))).status).toBe(404);
    expect((await verify.POST(json({ email: "a@b.co", code: "123456" }))).status).toBe(404);
  });

  it("sends a code to the normalised email", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { POST } = await import("../app/api/auth/otp/route");

    expect((await POST(json({ email: "  Asha@Example.COM " }))).status).toBe(200);
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "asha@example.com",
      options: { shouldCreateUser: true, emailRedirectTo: "http://localhost/auth/callback" },
    });

    const bad = await POST(json({ email: "not-an-email" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe("email");
  });

  it("refuses temporary inboxes without contacting Supabase", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { POST } = await import("../app/api/auth/otp/route");

    const res = await POST(json({ email: "test@yopmail.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Temporary inboxes/);
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("refuses emails outside the beta list, allowing listed emails and @domains", async () => {
    accountsOn();
    vi.stubEnv("BETA_ALLOWED_EMAILS", "asha@example.com, @team.test");
    const client = signedInAs(undefined);
    const { POST } = await import("../app/api/auth/otp/route");

    const res = await POST(json({ email: "stranger@gmail.com" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/private beta/);
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
    expect((await POST(json({ email: "Asha@Example.com" }))).status).toBe(200);
    expect((await POST(json({ email: "ravi@team.test" }))).status).toBe(200);
  });

  it("maps Supabase failures: its rate limit to 429, anything else to 502", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { POST } = await import("../app/api/auth/otp/route");

    client.auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect((await POST(json({ email: "a@b.co" }))).status).toBe(429);
    client.auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 500, code: "unexpected_failure" } });
    expect((await POST(json({ email: "a@b.co" }))).status).toBe(502);
  });

  it("limits code requests per IP", async () => {
    accountsOn();
    signedInAs(undefined);
    const { POST } = await import("../app/api/auth/otp/route");
    const req = () => new Request("http://localhost/api/auth/otp", { method: "POST", headers: { "x-forwarded-for": "192.0.2.50" }, body: JSON.stringify({ email: "a@b.co" }) });
    for (let i = 0; i < RATE_LIMITS["auth.otp"].limit; i++) expect((await POST(req())).status).toBe(200);
    expect((await POST(req())).status).toBe(429);
  });

  it("verifies the code and records terms consent; a wrong code records nothing", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { POST } = await import("../app/api/auth/verify/route");

    expect((await POST(json({ email: "Asha@example.com", code: "123456" }))).status).toBe(200);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: "asha@example.com", token: "123456", type: "email" });
    expect(ensureTermsConsent).toHaveBeenCalledWith(client, USER_ID);

    vi.mocked(ensureTermsConsent).mockClear();
    client.auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { code: "otp_expired" } });
    const wrong = await POST(json({ email: "asha@example.com", code: "000000" }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/wrong or has expired/);
    expect(ensureTermsConsent).not.toHaveBeenCalled();

    const malformed = await POST(json({ email: "asha@example.com", code: "12ab" }));
    expect(malformed.status).toBe(400);
    expect(client.auth.verifyOtp).toHaveBeenCalledTimes(2);
  });
});

describe("GET /auth/callback (Google, or the link in a sign-in email)", () => {
  const get = (query: string) => new Request(`http://localhost/auth/callback${query}`);

  it("exchanges the code, records consent and goes home", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { GET } = await import("../app/auth/callback/route");
    const res = await GET(get("?code=abc"));
    expect(res.headers.get("location")).toBe("http://localhost/");
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(ensureTermsConsent).toHaveBeenCalledWith(client, USER_ID);
  });

  it("sends failures back to sign-in", async () => {
    accountsOn();
    const client = signedInAs(undefined);
    const { GET } = await import("../app/auth/callback/route");
    // Supabase redirects with ?error=... when a link is expired or already used.
    expect((await GET(get("?error=access_denied"))).headers.get("location")).toBe("http://localhost/sign-in?error=callback");
    client.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: null }, error: { code: "bad_code_verifier" } });
    expect((await GET(get("?code=abc"))).headers.get("location")).toBe("http://localhost/sign-in?error=callback");
    expect(ensureTermsConsent).not.toHaveBeenCalled();
  });

  it("signs out anyone not on the beta list", async () => {
    accountsOn();
    vi.stubEnv("BETA_ALLOWED_EMAILS", "asha@example.com");
    const client = signedInAs(undefined);
    const { GET } = await import("../app/auth/callback/route");
    client.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: { id: USER_ID, email: "stranger@gmail.com" } }, error: null });
    expect((await GET(get("?code=abc"))).headers.get("location")).toBe("http://localhost/sign-in?error=beta");
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(ensureTermsConsent).not.toHaveBeenCalled();
  });
});

describe("/api/db/[collection]", () => {
  const profile = { id: "p1", name: "Asha", targetRole: "Nurse", experience: "fresher", weeklyGoal: 3, onboarded: true, createdAt: 1, futureField: "kept" };

  it("is a 404 when accounts are off, or for a collection that isn't served", async () => {
    const { GET } = await import("../app/api/db/[collection]/route");
    expect((await GET(json(undefined, "GET"), ctx("profile"))).status).toBe(404);
    accountsOn();
    signedInAs(USER_ID);
    expect((await GET(json(undefined, "GET"), ctx("passwords"))).status).toBe(404);
  });

  it("needs a session", async () => {
    accountsOn();
    signedInAs(undefined);
    const { GET } = await import("../app/api/db/[collection]/route");
    expect((await GET(json(undefined, "GET"), ctx("profile"))).status).toBe(401);
    expect(listItems).not.toHaveBeenCalled();
  });

  it("reads, writes and deletes only the caller's rows", async () => {
    accountsOn();
    const client = signedInAs(USER_ID);
    vi.mocked(listItems).mockResolvedValueOnce([profile]);
    const route = await import("../app/api/db/[collection]/route");

    expect(await (await route.GET(json(undefined, "GET"), ctx("profile"))).json()).toEqual({ items: [profile] });
    expect(listItems).toHaveBeenCalledWith(client, "profile", USER_ID);

    const put = await route.PUT(json(profile, "PUT"), ctx("profile"));
    expect(put.status).toBe(200);
    expect(putItem).toHaveBeenCalledWith(client, "profile", USER_ID, expect.objectContaining({ id: "p1", futureField: "kept", resume: "" }));

    expect((await route.DELETE(json(undefined, "DELETE"), ctx("profile"))).status).toBe(200);
    expect(removeItems).toHaveBeenCalledWith(client, "profile", USER_ID);
  });

  it("list collections: upsert by id keeping every field, and delete one item", async () => {
    accountsOn();
    const client = signedInAs(USER_ID);
    const route = await import("../app/api/db/[collection]/route");
    const item = await import("../app/api/db/[collection]/[id]/route");
    const sessionItem = { id: "s1", startedAt: 1, messages: [{ id: "m1", role: "candidate", text: "hi" }], extra: { kept: true } };

    expect((await route.PUT(json(sessionItem, "PUT"), ctx("sessions"))).status).toBe(200);
    expect(putItem).toHaveBeenCalledWith(client, "sessions", USER_ID, sessionItem);

    const del = await item.DELETE(json(undefined, "DELETE"), { params: Promise.resolve({ collection: "notes", id: "n1" }) });
    expect(del.status).toBe(200);
    expect(removeItems).toHaveBeenCalledWith(client, "notes", USER_ID, "n1");
  });

  it("list collections: an item without an id is rejected; deleting needs a session", async () => {
    accountsOn();
    signedInAs(USER_ID);
    const route = await import("../app/api/db/[collection]/route");
    expect((await route.PUT(json({ startedAt: 1 }, "PUT"), ctx("sessions"))).status).toBe(400);
    expect(putItem).not.toHaveBeenCalled();

    signedInAs(undefined);
    const item = await import("../app/api/db/[collection]/[id]/route");
    expect((await item.DELETE(json(undefined, "DELETE"), { params: Promise.resolve({ collection: "notes", id: "n1" }) })).status).toBe(401);
    expect(removeItems).not.toHaveBeenCalled();
  });

  it("rejects an invalid profile with field errors", async () => {
    accountsOn();
    signedInAs(USER_ID);
    const { PUT } = await import("../app/api/db/[collection]/route");
    const res = await PUT(json({ ...profile, weeklyGoal: "lots" }, "PUT"), ctx("profile"));
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toBe("weeklyGoal");
    expect(putItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account", () => {
  it("needs the secret key, then deletes the auth user (which cascades) and clears the session", async () => {
    accountsOn();
    const client = signedInAs(USER_ID);
    const { DELETE } = await import("../app/api/account/route");
    expect((await DELETE()).status).toBe(503);

    const deleteUser = vi.fn<(id: string) => Promise<{ error: null }>>(async () => ({ error: null }));
    vi.mocked(getSupabaseAdmin).mockReturnValueOnce({ auth: { admin: { deleteUser } } } as unknown as SupabaseClient);
    expect((await DELETE()).status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it("is a 401 without a session", async () => {
    accountsOn();
    signedInAs(undefined);
    const { DELETE } = await import("../app/api/account/route");
    expect((await DELETE()).status).toBe(401);
  });
});

describe("ensureTermsConsent", () => {
  /** A chainable query builder that resolves to `result` and records what was inserted. */
  function consentsTable(existing: unknown[]) {
    const inserted: unknown[] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      limit: () => Promise.resolve({ data: existing, error: null }),
      insert: (row: unknown) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return { client: { from: () => builder } as unknown as SupabaseClient, inserted };
  }

  it("records the current terms version once", async () => {
    const { ensureTermsConsent: real } = await vi.importActual<typeof import("./userData")>("./userData");
    const fresh = consentsTable([]);
    await real(fresh.client, USER_ID);
    expect(fresh.inserted).toEqual([{ user_id: USER_ID, kind: "terms", version: TERMS_VERSION, value: {} }]);

    const already = consentsTable([{ id: "c1" }]);
    await real(already.client, USER_ID);
    expect(already.inserted).toEqual([]);
  });
});

describe("page access", () => {
  const off = { mode: "off" as const, user: null, google: false };
  const out = { mode: "supabase" as const, user: null, google: false };
  const inn = { mode: "supabase" as const, user: { id: USER_ID, email: null }, google: false };

  it.each([
    // [path, auth, onboarded, expected redirect]
    ["/", out, false, "/welcome"],
    ["/practice", out, false, "/welcome"],
    ["/sign-in", out, false, null],
    ["/terms", out, false, null],
    ["/", inn, false, "/onboarding"],
    ["/welcome", inn, false, "/onboarding"],
    ["/onboarding", inn, false, null],
    ["/privacy", inn, false, null],
    ["/sign-in", inn, true, "/"],
    ["/welcome", inn, true, "/"],
    ["/practice", inn, true, null],
    ["/", off, false, "/welcome"],
    ["/welcome", off, false, null],
    ["/onboarding", off, false, null],
    ["/welcome", off, true, "/"],
  ] as const)("%s (%o, onboarded %s) → %s", (path, auth, onboarded, expected) => {
    expect(redirectFor(path, auth, onboarded)).toBe(expected);
  });

  it("proxy lets API routes, the OAuth callback and public pages through", () => {
    for (const p of ["/api/interview/turn", "/auth/callback", "/welcome", "/sign-in", "/terms", "/opengraph-image"]) expect(isPublicPath(p), p).toBe(true);
    for (const p of ["/", "/practice", "/onboarding", "/welcomeback"]) expect(isPublicPath(p), p).toBe(false);
  });

  it("recognises the mobile app's user agent", () => {
    expect(isInApp("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 OfferlyApp/1.0.0")).toBe(true);
    expect(isInApp("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36")).toBe(false);
  });
});
