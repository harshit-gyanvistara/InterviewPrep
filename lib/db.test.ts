import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, Session } from "./types";

// lib/db.ts in the browser (plans/auth.md A7): where each user's data lives in localStorage, the
// server-side profile, and the one-time takeover of data saved before accounts existed.
// window/localStorage and fetch are faked; each test loads a fresh copy of the module.

const PREFIX = "interviewprep:v1:";
const USER = { id: "u1", email: "asha@example.com" };

let storage: Map<string, string>;
let serverProfiles: Profile[];
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
  serverProfiles = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
    },
    dispatchEvent: () => true,
  });
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return Response.json(meStatus === 200 ? auth : { error: "Server down" }, { status: meStatus });
    if (url === "/api/db/profile") {
      if (init?.method === "PUT") {
        serverProfiles = [JSON.parse(String(init.body))];
        return Response.json({ item: serverProfiles[0] });
      }
      if (init?.method === "DELETE") {
        serverProfiles = [];
        return Response.json({ ok: true });
      }
      return Response.json({ items: serverProfiles });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
}

const load = async () => (await import("./db")).db;
const seedLegacy = () => {
  storage.set(PREFIX + "profiles", JSON.stringify([profile("Old")]));
  storage.set(PREFIX + "sessions", JSON.stringify([session]));
};

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AUTH_MODE=off", () => {
  it("uses the unprefixed keys, as before accounts", async () => {
    setup({ mode: "off", user: { id: "local", email: null }, google: false });
    seedLegacy();
    const db = await load();
    expect((await db.profiles.list())[0].name).toBe("Old");
    expect(await db.sessions.list()).toEqual([session]);
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/db/profile", expect.anything());
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

  it("first sign-in takes over this browser's earlier data: profile to the server, the rest under the user's prefix", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    seedLegacy();
    const db = await load();

    expect((await db.profiles.list())[0].name).toBe("Old");
    expect(serverProfiles.map((p) => p.name)).toEqual(["Old"]);
    expect(await db.sessions.list()).toEqual([session]);
    expect(storage.get(`${PREFIX}u:u1:sessions`)).toBe(JSON.stringify([session]));
    expect(storage.has(PREFIX + "sessions")).toBe(false);
    expect(storage.has(PREFIX + "profiles")).toBe(false);
    expect(storage.get(PREFIX + "adopted-by")).toBe("u1");
  });

  it("never overwrites a profile the account already has, or data already under the user's prefix", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    seedLegacy();
    const mine = [{ id: "s-mine", startedAt: 2 }];
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify(mine));
    serverProfiles = [profile("Server")];
    const db = await load();

    expect((await db.profiles.list())[0].name).toBe("Server");
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/db/profile", expect.objectContaining({ method: "PUT" }));
    expect(await db.sessions.list()).toEqual(mine);
  });

  it("runs once per browser: a second account signing in here starts empty", async () => {
    setup({ mode: "supabase", user: { id: "u2", email: null }, google: false });
    storage.set(PREFIX + "adopted-by", "u1");
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify([session]));
    const db = await load();
    expect(await db.sessions.list()).toEqual([]);
    expect(await db.profiles.list()).toEqual([]);
  });

  it("keeps the profile cached after the first read and updates it on save", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    const db = await load();
    await db.profiles.list();
    await db.profiles.list();
    expect(fetchSpy.mock.calls.filter(([u, init]) => u === "/api/db/profile" && !init?.method)).toHaveLength(1);

    await db.profiles.put(profile("New"));
    expect((await db.profiles.list())[0].name).toBe("New");
    expect(serverProfiles[0].name).toBe("New");
  });

  it("clearAll deletes this user's local data and server profile, not other users'", async () => {
    setup({ mode: "supabase", user: USER, google: false });
    storage.set(PREFIX + "adopted-by", "u1");
    storage.set(`${PREFIX}u:u1:sessions`, JSON.stringify([session]));
    storage.set(`${PREFIX}u:u2:sessions`, JSON.stringify([session]));
    serverProfiles = [profile("Me")];
    const db = await load();

    await db.clearAll();
    expect(storage.has(`${PREFIX}u:u1:sessions`)).toBe(false);
    expect(storage.has(`${PREFIX}u:u2:sessions`)).toBe(true);
    expect(serverProfiles).toEqual([]);
  });

  it("reports a failed /api/auth/me as an error instead of guessing", async () => {
    setup(undefined, { meStatus: 503 });
    const { getAuth } = await import("./db");
    await expect(getAuth()).resolves.toEqual({ mode: "supabase", user: null, google: false, error: "Server down" });
  });
});
