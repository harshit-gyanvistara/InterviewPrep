"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Binder, type CortexPage, type Note, type NoteLink, type Pack, type Profile, type Report, type Roadmap, type Session, type Settings, type Story } from "./types";
import { DEFAULT_CATALOG, type Catalog } from "./catalog";

/**
 * Storage layer. Everything goes through `db`, which is async and collection-based, so moving a
 * collection to the server only means swapping its `Collection` adapter (implementationPlan M2.5).
 *
 * Accounts (plans/auth.md): the first call asks /api/auth/me who is signed in. With accounts on,
 * the profile lives on the server (/api/db/profile) and every other collection stays in
 * localStorage under a per-user key prefix, so people sharing a browser don't see each other's
 * data. With AUTH_MODE=off there is one implicit user and the keys are unprefixed, as before.
 */

const PREFIX = "interviewprep:v1:";
const CHANGE_EVENT = "interviewprep:change";
/** Set once a signed-in user has taken over this browser's pre-accounts data. */
const ADOPTED_KEY = `${PREFIX}adopted-by`;

const COLLECTIONS = ["profiles", "sessions", "reports", "roadmaps", "stories", "settings", "customPacks", "notes", "binders", "cortexPages"] as const;
type CollectionName = (typeof COLLECTIONS)[number];

interface Collection<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<T>;
  remove(id: string): Promise<void>;
}

// ---- Who this browser is signed in as ----

export interface AuthState {
  mode: "supabase" | "off";
  user: { id: string; email: string | null } | null;
  google: boolean;
  /** /api/auth/me failed (offline, server down); the Shell offers a retry instead of guessing. */
  error?: string;
}

let authRequest: Promise<AuthState> | null = null;

/** Who is signed in. Fetched once and cached until `resetSession()` (after sign-in or sign-out). */
export function getAuth(): Promise<AuthState> {
  authRequest ??= fetch("/api/auth/me", { cache: "no-store" })
    .then(async (r) => {
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || `Server error (${r.status})`);
      return json as AuthState;
    })
    .then(async (auth) => {
      await adoptLocalData(auth);
      return auth;
    })
    .catch((e: unknown): AuthState => ({ mode: "supabase", user: null, google: false, error: e instanceof Error ? e.message : "Couldn't reach the server." }));
  return authRequest;
}

/** Where a collection lives in localStorage for this user, or null when nobody is signed in. */
function storageKey(auth: AuthState, key: string): string | null {
  if (auth.mode === "off") return PREFIX + key;
  return auth.user ? `${PREFIX}u:${auth.user.id}:${key}` : null;
}

// ---- Adapters ----

function read<T>(fullKey: string): T[] {
  try {
    const raw = window.localStorage.getItem(fullKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT));

function write<T>(fullKey: string, items: T[]) {
  try {
    window.localStorage.setItem(fullKey, JSON.stringify(items));
    notify();
  } catch (e) {
    console.error("localStorage write failed", e);
  }
}

function localCollection<T extends { id: string }>(key: CollectionName): Collection<T> {
  // Signed out (accounts on): nothing to read, and writes go nowhere. Only public pages render then.
  const at = async () => storageKey(await getAuth(), key);
  return {
    async list() {
      const k = await at();
      return k ? read<T>(k) : [];
    },
    async get(id) {
      return (await this.list()).find((i) => i.id === id);
    },
    async put(item) {
      const k = await at();
      if (!k) return item;
      const items = read<T>(k);
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      write(k, items);
      return item;
    },
    async remove(id) {
      const k = await at();
      if (k) write(k, read<T>(k).filter((i) => i.id !== id));
    },
  };
}

async function apiError(r: Response): Promise<Error> {
  const json = await r.json().catch(() => ({}));
  return new Error((json as { error?: string }).error || `Server error (${r.status})`);
}

/**
 * A collection with one item per user, stored by /api/db/[name]. Cached after the first read, so
 * the change events from local collections don't refetch it.
 */
function remoteSingleton<T extends { id: string }>(name: string): Collection<T> & { reset(): void } {
  let cache: T[] | null = null;
  const url = `/api/db/${name}`;
  return {
    reset() {
      cache = null;
    },
    async list() {
      if (!cache) {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw await apiError(r);
        cache = ((await r.json()) as { items: T[] }).items;
      }
      return cache;
    },
    async get(id) {
      return (await this.list()).find((i) => i.id === id);
    },
    async put(item) {
      const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      if (!r.ok) throw await apiError(r);
      cache = [item];
      notify();
      return item;
    },
    async remove() {
      const r = await fetch(url, { method: "DELETE" });
      if (!r.ok) throw await apiError(r);
      cache = [];
      notify();
    },
  };
}

/** Uses `remote` when signed in with an account, `local` otherwise (AUTH_MODE=off). */
function byAuth<T extends { id: string }>(remote: Collection<T>, local: Collection<T>): Collection<T> {
  const pick = async () => {
    const auth = await getAuth();
    return auth.mode === "supabase" && auth.user ? remote : local;
  };
  return {
    list: async () => (await pick()).list(),
    get: async (id) => (await pick()).get(id),
    put: async (item) => (await pick()).put(item),
    remove: async (id) => (await pick()).remove(id),
  };
}

const remoteProfile = remoteSingleton<Profile>("profile");

/** Forget the cached session and server data, then let every query reload. Call after sign-in or sign-out. */
export function resetSession() {
  authRequest = null;
  remoteProfile.reset();
  notify();
}

/**
 * First sign-in in a browser that was used before accounts existed: the signed-in user takes over
 * that data (plans/auth.md A7). Local collections move under their key prefix; the profile is
 * uploaded unless they already have one on the server. Runs once per browser.
 */
async function adoptLocalData(auth: AuthState) {
  if (auth.mode !== "supabase" || !auth.user) return;
  try {
    if (window.localStorage.getItem(ADOPTED_KEY)) return;
    const legacy = COLLECTIONS.filter((c) => window.localStorage.getItem(PREFIX + c) !== null);
    const legacyProfile = read<Profile>(PREFIX + "profiles")[0];
    if (legacyProfile && (await remoteProfile.list()).length === 0) await remoteProfile.put(legacyProfile);
    for (const c of legacy) {
      const to = storageKey(auth, c)!;
      if (c !== "profiles" && window.localStorage.getItem(to) === null) window.localStorage.setItem(to, window.localStorage.getItem(PREFIX + c)!);
      window.localStorage.removeItem(PREFIX + c);
    }
    window.localStorage.setItem(ADOPTED_KEY, auth.user.id);
  } catch (e) {
    // Leave the old data where it is and try again on the next page load.
    console.error("Couldn't move this browser's earlier data into your account", e);
  }
}

export const db = {
  profiles: byAuth(remoteProfile, localCollection<Profile>("profiles")),
  sessions: localCollection<Session>("sessions"),
  reports: localCollection<Report>("reports"),
  roadmaps: localCollection<Roadmap>("roadmaps"),
  stories: localCollection<Story>("stories"),
  settings: localCollection<Settings>("settings"),
  customPacks: localCollection<Pack>("customPacks"),
  notes: localCollection<Note>("notes"),
  binders: localCollection<Binder>("binders"),
  cortexPages: localCollection<CortexPage>("cortexPages"),
  /** Deletes this user's data: the local collections in this browser and, with accounts, the server profile. */
  async clearAll() {
    const auth = await getAuth();
    for (const c of COLLECTIONS) {
      const k = storageKey(auth, c);
      if (k) window.localStorage.removeItem(k);
    }
    if (auth.mode === "supabase" && auth.user) for (const p of await remoteProfile.list()) await remoteProfile.remove(p.id);
    notify();
  },
  async exportAll() {
    const auth = await getAuth();
    const local = (c: CollectionName) => {
      const k = storageKey(auth, c);
      return k ? read<unknown>(k) : [];
    };
    return {
      profiles: await db.profiles.list(),
      sessions: local("sessions"),
      reports: local("reports"),
      roadmaps: local("roadmaps"),
      stories: local("stories"),
      settings: local("settings"),
      customPacks: local("customPacks"),
      notes: local("notes"),
      binders: local("binders"),
      cortexPages: local("cortexPages"),
    };
  },
  async importAll(data: Record<string, unknown>) {
    const auth = await getAuth();
    for (const c of COLLECTIONS) {
      const items = data[c];
      if (!Array.isArray(items)) continue;
      if (c === "profiles") {
        if (items[0]) await db.profiles.put(items[0] as Profile);
        continue;
      }
      const k = storageKey(auth, c);
      if (k) write(k, items);
    }
  },
};

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Re-runs `fn` on mount and whenever any collection changes. `error` is set if the last run failed. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  const key = JSON.stringify(deps);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fnRef.current().then(
        (d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          if (!alive) return;
          setError(e instanceof Error ? e.message : "Something went wrong.");
          setLoading(false);
        },
      );
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, load);
    };
  }, [key]);

  return { data, loading, error };
}

/** Who is signed in (see getAuth). */
export const useAuth = () => useQuery(getAuth, []);

export const useProfile = () =>
  useQuery(async () => (await db.profiles.list())[0], []);
export const useSessions = () =>
  useQuery(async () => (await db.sessions.list()).sort((a, b) => b.startedAt - a.startedAt), []);
export const useReports = () =>
  useQuery(async () => (await db.reports.list()).sort((a, b) => b.createdAt - a.createdAt), []);

export const useStories = () =>
  useQuery(async () => (await db.stories.list()).sort((a, b) => b.createdAt - a.createdAt), []);
export function useSettings() {
  const { data, loading } = useQuery(async () => (await db.settings.list())[0], []);
  return { settings: { ...DEFAULT_SETTINGS, ...data } as Settings, loading };
}
export const saveSettings = (patch: Partial<Settings>, current: Settings) => db.settings.put({ ...current, ...patch, id: "settings" });

export const useCustomPacks = () =>
  useQuery(async () => (await db.customPacks.list()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), []);

let catalogRequest: Promise<Catalog> | null = null;
let catalogLoaded: Catalog | null = null;

/**
 * The fields and built-in pack library from the server (Supabase via /api/catalog), fetched once
 * per page load. Starts from the code defaults so pages render immediately, and keeps them if the
 * request fails.
 */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(catalogLoaded ?? DEFAULT_CATALOG);
  const [loading, setLoading] = useState(!catalogLoaded);
  useEffect(() => {
    let live = true;
    catalogRequest ??= fetch("/api/catalog")
      .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : DEFAULT_CATALOG))
      .catch(() => DEFAULT_CATALOG)
      .then((c) => (catalogLoaded = c));
    catalogRequest.then((c) => {
      if (!live) return;
      setCatalog(c);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);
  return { catalog, loading };
}

/** All packs available to this browser: the built-in library plus anything generated from a job description. */
export function useAllPacks() {
  const { data: custom = [], loading } = useCustomPacks();
  const { catalog, loading: catalogLoading } = useCatalog();
  const all = [...catalog.packs, ...custom];
  return { all, custom, catalog, byId: (id: string) => all.find((p) => p.id === id), loading: loading || catalogLoading };
}

/** All notes, pinned first then most recently updated. */
export const useNoteList = () =>
  useQuery(async () => (await db.notes.list()).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), []);

/** Notes attached to one specific thing elsewhere in the app (a session, a pack, a roadmap item, a story...). */
export function useNotesFor(link?: Pick<NoteLink, "type" | "id">) {
  const { data: all = [], loading } = useNoteList();
  const notes = link ? all.filter((n) => n.links.some((l) => l.type === link.type && l.id === link.id)) : [];
  return { notes, loading };
}

// ---- Cortex: the full notebook ----

export const useBinders = () => useQuery(async () => (await db.binders.list()).sort((a, b) => a.createdAt - b.createdAt), []);

export const useCortexPages = (binderId?: string) =>
  useQuery(
    async () => {
      const all = await db.cortexPages.list();
      const scoped = binderId ? all.filter((p) => p.binderId === binderId) : all;
      return scoped.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    },
    [binderId],
  );

export const useCortexPage = (id?: string) => useQuery(async () => (id ? db.cortexPages.get(id) : undefined), [id]);
