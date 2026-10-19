"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Binder, type CortexPage, type Note, type NoteLink, type Pack, type Profile, type Report, type Roadmap, type Session, type Settings, type Story } from "./types";
import { DEFAULT_CATALOG, type Catalog } from "./catalog";

/**
 * Storage layer. Everything goes through `db`, which is async and collection-based, so moving a
 * collection to the server only means swapping its `Collection` adapter (implementationPlan M2.5).
 *
 * Accounts (plans/auth.md, plans/server-history.md): the first call asks /api/auth/me who is signed
 * in. With accounts on, every collection lives on the server (/api/db/<name>), cached in memory and
 * saved through a retry queue. With AUTH_MODE=off everything stays in localStorage, unprefixed.
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
      await moveLocalToServer(auth);
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

// ---- Server collections with a save queue (plans/server-history.md) ----

const SYNC_EVENT = "interviewprep:sync";
type Op = { c: string; kind: "put"; item: { id: string } } | { c: string; kind: "remove"; id: string };

/** Unsent saves live in localStorage, so a failed save survives a reload and is retried. */
async function queueKey(): Promise<string | null> {
  const auth = await getAuth();
  return auth.mode === "supabase" && auth.user ? `${PREFIX}u:${auth.user.id}:pending` : null;
}
async function readQueue(): Promise<Op[]> {
  const k = await queueKey();
  return k ? read<Op>(k) : [];
}
async function writeQueue(ops: Op[]) {
  const k = await queueKey();
  if (!k) return;
  try {
    if (ops.length) window.localStorage.setItem(k, JSON.stringify(ops));
    else window.localStorage.removeItem(k);
  } catch (e) {
    console.error("Couldn't keep the unsent changes", e);
  }
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: ops.length }));
}

async function sendOp(op: Op) {
  const r =
    op.kind === "put"
      ? await fetch(`/api/db/${op.c}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.item) })
      : await fetch(`/api/db/${op.c}/${encodeURIComponent(op.id)}`, { method: "DELETE" });
  if (!r.ok) throw await apiError(r);
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/** Sends queued saves in order; stops at the first failure and keeps the rest for the next try. */
function flushQueue(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    do {
      flushAgain = false;
      let ops = await readQueue();
      while (ops.length) {
        try {
          await sendOp(ops[0]);
        } catch (e) {
          console.error("Save failed; will retry", e);
          return;
        }
        // Re-read: more saves may have been queued while this one was in flight.
        ops = (await readQueue()).slice(1);
        await writeQueue(ops);
      }
    } while (flushAgain);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function enqueue(op: Op) {
  const ops = await readQueue();
  // A newer save of the same item replaces an unsent older one.
  const key = op.kind === "put" ? op.item.id : op.id;
  await writeQueue([...ops.filter((o) => !(o.c === op.c && (o.kind === "put" ? o.item.id : o.id) === key)), op]);
  void flushQueue();
}

/** Number of saves not yet on the server (shown as a quiet note by the shell). */
export async function pendingSaves(): Promise<number> {
  return (await readQueue()).length;
}
export const SYNC_EVENT_NAME = SYNC_EVENT;

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
  window.addEventListener("focus", () => void flushQueue());
}

/**
 * A collection with many items per user, stored by /api/db/[name]. Read once per page load, then
 * served from memory; writes update memory and fire the change event at once, then go out through
 * the save queue. Unsent saves are applied on top of what the server returns, so nothing flickers back.
 */
function remoteCollection<T extends { id: string }>(name: string): Collection<T> & { reset(): void } {
  let cache: T[] | null = null;
  let loading: Promise<T[]> | null = null;
  const load = async (): Promise<T[]> => {
    const r = await fetch(`/api/db/${name}`, { cache: "no-store" });
    if (!r.ok) throw await apiError(r);
    let items = ((await r.json()) as { items: T[] }).items;
    for (const op of await readQueue()) {
      if (op.c !== name) continue;
      items = op.kind === "put" ? [...items.filter((i) => i.id !== op.item.id), op.item as T] : items.filter((i) => i.id !== op.id);
    }
    return items;
  };
  return {
    reset() {
      cache = null;
      loading = null;
    },
    async list() {
      if (cache) return cache;
      loading ??= load().finally(() => {
        loading = null;
      });
      cache = await loading;
      return cache;
    },
    async get(id) {
      return (await this.list()).find((i) => i.id === id);
    },
    async put(item) {
      const items = await this.list();
      const idx = items.findIndex((i) => i.id === item.id);
      cache = idx >= 0 ? items.map((i, n) => (n === idx ? item : i)) : [...items, item];
      notify();
      await enqueue({ c: name, kind: "put", item });
      return item;
    },
    async remove(id) {
      cache = (await this.list()).filter((i) => i.id !== id);
      notify();
      await enqueue({ c: name, kind: "remove", id });
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
const remote = {
  sessions: remoteCollection<Session>("sessions"),
  reports: remoteCollection<Report>("reports"),
  roadmaps: remoteCollection<Roadmap>("roadmaps"),
  stories: remoteCollection<Story>("stories"),
  settings: remoteCollection<Settings>("settings"),
  customPacks: remoteCollection<Pack>("customPacks"),
  notes: remoteCollection<Note>("notes"),
  binders: remoteCollection<Binder>("binders"),
  cortexPages: remoteCollection<CortexPage>("cortexPages"),
};
type ListCollection = keyof typeof remote;
const LIST_COLLECTIONS = Object.keys(remote) as ListCollection[];

/** Forget the cached session and server data, then let every query reload. Call after sign-in or sign-out. */
export function resetSession() {
  authRequest = null;
  remoteProfile.reset();
  for (const c of LIST_COLLECTIONS) remote[c].reset();
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

/**
 * After history moved to the server: a signed-in user's collections in this browser are uploaded once
 * (only items the server doesn't have), then marked as moved. The local copy is left as a backup.
 */
async function moveLocalToServer(auth: AuthState) {
  if (auth.mode !== "supabase" || !auth.user) return;
  const marker = `${PREFIX}u:${auth.user.id}:moved-to-server`;
  try {
    if (window.localStorage.getItem(marker)) return;
    for (const c of LIST_COLLECTIONS) {
      const local = read<{ id: string }>(storageKey(auth, c)!);
      if (!local.length) continue;
      const r = await fetch(`/api/db/${c}`, { cache: "no-store" });
      if (!r.ok) throw await apiError(r);
      const onServer = new Set(((await r.json()) as { items: { id: string }[] }).items.map((i) => i.id));
      for (const item of local) if (!onServer.has(item.id)) await sendOp({ c, kind: "put", item });
    }
    window.localStorage.setItem(marker, new Date().toISOString());
  } catch (e) {
    // Try again on the next page load; uploads are upserts, so repeating is safe.
    console.error("Couldn't move this browser's history to your account yet", e);
  }
}

export const db = {
  profiles: byAuth(remoteProfile, localCollection<Profile>("profiles")),
  sessions: byAuth(remote.sessions, localCollection<Session>("sessions")),
  reports: byAuth(remote.reports, localCollection<Report>("reports")),
  roadmaps: byAuth(remote.roadmaps, localCollection<Roadmap>("roadmaps")),
  stories: byAuth(remote.stories, localCollection<Story>("stories")),
  settings: byAuth(remote.settings, localCollection<Settings>("settings")),
  customPacks: byAuth(remote.customPacks, localCollection<Pack>("customPacks")),
  notes: byAuth(remote.notes, localCollection<Note>("notes")),
  binders: byAuth(remote.binders, localCollection<Binder>("binders")),
  cortexPages: byAuth(remote.cortexPages, localCollection<CortexPage>("cortexPages")),
  /** Deletes this user's data: on the server with accounts, plus anything left in this browser. */
  async clearAll() {
    const auth = await getAuth();
    if (auth.mode === "supabase" && auth.user) {
      await writeQueue([]);
      for (const c of LIST_COLLECTIONS) {
        const r = await fetch(`/api/db/${c}`, { method: "DELETE" });
        if (!r.ok) throw await apiError(r);
        remote[c].reset();
      }
      for (const p of await remoteProfile.list()) await remoteProfile.remove(p.id);
    }
    for (const c of COLLECTIONS) {
      const k = storageKey(auth, c);
      if (k) window.localStorage.removeItem(k);
    }
    notify();
  },
  async exportAll() {
    const out: Record<string, unknown[]> = { profiles: await db.profiles.list() };
    for (const c of LIST_COLLECTIONS) out[c] = await db[c].list();
    return out;
  },
  async importAll(data: Record<string, unknown>) {
    const items = (c: string) => (Array.isArray(data[c]) ? (data[c] as { id: string }[]) : []);
    const profile = items("profiles")[0];
    if (profile) await db.profiles.put(profile as Profile);
    for (const c of LIST_COLLECTIONS) for (const item of items(c)) await (db[c] as Collection<{ id: string }>).put(item);
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

export interface UsageMeter {
  meter: "mocks" | "ai_calls";
  used: number;
  limit: number | null;
  resetsAt: number | null;
}

/** The user's allowances from /api/usage; null when signed out or unavailable (never blocks a page). */
export const useUsage = () =>
  useQuery(async () => {
    const res = await fetch("/api/usage", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return null;
    return (await res.json()) as { package: string; meters: UsageMeter[] };
  }, []);

/** The orgs the user belongs to (Settings → Organisations, the "Practising for" switcher); [] when none or signed out. */
export const useMyOrgs = () =>
  useQuery(async () => {
    const auth = await getAuth();
    if (auth.mode !== "supabase" || !auth.user) return [] as MyOrgSummary[];
    const res = await fetch("/api/me/orgs", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return [] as MyOrgSummary[];
    return ((await res.json()) as { orgs: MyOrgSummary[] }).orgs;
  }, []);

/** What the browser needs to know about one of the user's orgs. */
export interface MyOrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  allowedPackIds: string[] | null;
}

/** The org the user is practising for, if they still belong to it; null means practising as themselves. */
export const practisingFor = (settings: Settings, orgs: MyOrgSummary[] | null | undefined) =>
  (settings.practisingFor && orgs?.find((o) => o.id === settings.practisingFor)) || null;

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
