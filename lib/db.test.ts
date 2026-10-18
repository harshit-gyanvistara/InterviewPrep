import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, Session } from "./types";

// lib/db.ts in the browser (plans/auth.md A7, plans/server-history.md): where each user's data
// lives, the server collections with their memory cache and save queue, and the one-time moves of
// older browser data. window/localStorage and fetch are faked; each test loads a fresh module.

const PREFIX = "interviewprep:v1:";
const USER = { id: "u1", email: "asha@example.com" };

let storage: Map<string, string>;
/** The fake server: items per collection ("profile" holds at most one). */
let server: Record<string, { id: string }[]>;
/** When true, every write to the server fails with a 503. */
let serverDown: boolean;
let fetchSpy: ReturnType<typeof vi.fn>;

const profile = (name: string): Profile => ({
  id: `p-${name}`,
  name,
  targetRole: "Nurse",
  targetCompanies: "",
  jobDescription: "",
  experience: "fresher",
  resume: "",
  weeklyGoal: 3,
  onboarded: true,
  createdAt: 1,
});
const session = { id: "s1", startedAt: 1 } as unknown as Session;

function setup(auth: unknown, { meStatus = 200 } = {}) {
  storage = new Map();
  server = {};
  serverDown = false;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
  });
  vi.stubGlobal("CustomEvent", class extends Event { detail: unknown; constructor(t: string, o?: { detail?: unknown }) { super(t); this.detail = o?.detail; } });
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return Response.json(meStatus === 200 ? auth : { error: "Server down" }, { status: meStatus });
    const m = url.match(/^\/api\/db\/([^/]+)(?:\/(.+))?$/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const [, c, id] = m;
    const method = init?.method ?? "GET";
    if (method !== "GET" && serverDown) return Response.json({ error: "down" }, { status: 503 });
    const items = (server[c] ??= []);
    if (method === "PUT") {
      const item = JSON.parse(String(init!.body));
      server[c] = c === "profile" ? [item] : [...items.filter((i) => i.id !== item.id), item];
      return Response.json({ item });
    }
    if (method === "DELETE") {
      server[c] = id ? items.filter((i) => i.id !== decodeURIComponent(id)) : [];
      return Response.json({ ok: true });
    }
    return Response.json({ items });
  });
  vi.stubGlobal("fetch", fetchSpy);
}

const load = async () => (await import("./db")).db;
const seedLegacy = () => {
  storage.set(PREFIX + "profiles", JSON.stringify([profile("Old")]));
  storage.set(PREFIX + "sessions", JSON.stringify([session]));
};
/** Lets the fire-and-forget save queue finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const gets = (url: string) => fetchSpy.mock.calls.filter(([u, init]) => u === url && !init?.method).length;

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AUTH_MODE=off", () => {
  it("uses the unprefixed localStorage keys and never the server", async () => {
    setup({ mode: "off", user: { id: "local", email: null }, google: false });
    seedLegacy();
    const db = await load();
    expect((await db.profiles.list())[0].name).toBe("Old");
    expect(await db.sessions.list()).toEqual([session]);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/api/db/"))).toBe(false);
  });
});

describe("accounts on", () => {
  it("signed out: nothing is read and writes go nowhere", async () => {
    setup({ mode: "supabase", user: null, google: false });
    seedLegacy();
    const db = await load();
    expect(await db.profiles.list()).toEqual([]);
    expect(await db.sessions.list()).toEqual([]);
    await db.notes.put({ id: "n1" } as never);
    expect([...storage.keys()].some((k) => k.includes("notes"))).toBe(false);
  });

  it("first sign-in: earlier browser data goes to the account on the server, and the local copy stays as a backup", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    seedLegacy();
    const db = await load();

    expect((await db.profiles.list())[0].name).toBe("Old");
    expect(server.profile.map((p) => (p as Profile).name)).toEqual(["Old"]);
    expect(await db.sessions.list()).toEqual([session]);
    expect(server.sessions).toEqual([session]);
    expect(storage.get(`${PREFIX}u:u1:sessions`)).toBe(JSON.stringify([session]));
    expect(storage.has(`${PREFIX}u:u1:moved-to-server`)).toBe(true);
    expect(storage.get(PREFIX + "adopted-by")).toBe("u1");
  });

  it("uploads only items the server doesn't have, and never overwrites an existing profile", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    seedLegacy();
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify([{ id: "s-mine", startedAt: 2 }, { id: "s-both", startedAt: 3, local: true }]));
    server.profile = [profile("Server")];
    server.sessions = [{ id: "s-both", startedAt: 3 } as never];
    const db = await load();

    expect((await db.profiles.list())[0].name).toBe("Server");
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/db/profile", expect.objectContaining({ method: "PUT" }));
    expect((await db.sessions.list()).map((s) => s.id).sort()).toEqual(["s-both", "s-mine"]);
    expect(server.sessions.find((s) => s.id === "s-both")).not.toHaveProperty("local");
  });

  it("moves local data once: a later page load doesn't upload again", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    storage.set(`${PREFIX}u:u1:moved-to-server`, "done");
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify([session]));
    const db = await load();
    expect(await db.sessions.list()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/db/sessions", expect.objectContaining({ method: "PUT" }));
  });

  it("keeps the profile cached after the first read and updates it on save", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    const db = await load();
    await db.profiles.list();
    await db.profiles.list();
    expect(gets("/api/db/profile")).toBe(1);

    await db.profiles.put(profile("New"));
    expect((await db.profiles.list())[0].name).toBe("New");
    expect((server.profile[0] as Profile).name).toBe("New");
  });

  it("server collections: read once, then saves and deletes show at once and reach the server", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    server.notes = [{ id: "n1" }];
    const db = await load();

    expect(await db.notes.list()).toEqual([{ id: "n1" }]);
    await db.notes.list();
    expect(gets("/api/db/notes")).toBe(1);

    await db.notes.put({ id: "n2" } as never);
    expect((await db.notes.list()).map((n) => n.id)).toEqual(["n1", "n2"]);
    await db.notes.remove("n1");
    expect((await db.notes.list()).map((n) => n.id)).toEqual(["n2"]);
    await settle();
    expect(server.notes).toEqual([{ id: "n2" }]);
    expect(await (await import("./db")).pendingSaves()).toBe(0);
  });

  it("a failed save is kept, survives a reload, and is sent on the next try", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    const db = await load();
    await db.sessions.list();

    serverDown = true;
    await db.sessions.put({ id: "s-live", startedAt: 5, turn: 1 } as never);
    await db.sessions.put({ id: "s-live", startedAt: 5, turn: 2 } as never);
    await settle();
    const { pendingSaves } = await import("./db");
    expect(await pendingSaves()).toBe(1); // the newer save replaced the older unsent one
    expect(server.sessions ?? []).toEqual([]);

    // Reload: the unsent change still shows on top of what the server returns.
    vi.resetModules();
    const db2 = await load();
    expect(await db2.sessions.get("s-live")).toMatchObject({ turn: 2 });

    serverDown = false;
    await db2.sessions.put({ id: "s-other", startedAt: 6 } as never);
    await settle();
    expect(server.sessions.map((s) => s.id).sort()).toEqual(["s-live", "s-other"]);
    expect(await (await import("./db")).pendingSaves()).toBe(0);
  });

  it("clearAll deletes this user's server data and local copies, not other users'", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    storage.set(PREFIX + "adopted-by", "u1");
    storage.set(`${PREFIX}u:u1:moved-to-server`, "done");
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify([session]));
    storage.set(`${PREFIX}u:u2:sessions`, JSON.stringify([session]));
    server.profile = [profile("Me")];
    server.sessions = [session];
    server.notes = [{ id: "n1" }];
    const db = await load();

    await db.clearAll();
    expect(server.profile).toEqual([]);
    expect(server.sessions).toEqual([]);
    expect(server.notes).toEqual([]);
    expect(storage.has(`${PREFIX}u:u1:sessions`)).toBe(false);
    expect(storage.has(`${PREFIX}u:u2:sessions`)).toBe(true);
    expect(await db.sessions.list()).toEqual([]);
  });

  it("reports a failed /api/auth/me as an error instead of guessing", async () => {
    setup(undefined, { meStatus: 503 });
    const { getAuth } = await import("./db");
    await expect(getAuth()).resolves.toEqual({ mode: "supabase", user: null, google: false, error: "Server down" });
  });
});
