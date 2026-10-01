"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Binder, type CortexPage, type Note, type NoteLink, type Pack, type Profile, type Report, type Roadmap, type Session, type Settings, type Story } from "./types";
import { PACKS } from "./packs";

/**
 * Storage layer. Everything goes through `db`, which is async and collection-based,
 * so swapping localStorage for a real database later only means re-implementing
 * the `Collection` adapter below (e.g. fetch("/api/db/...") against Postgres).
 */

const PREFIX = "interviewprep:v1:";
const CHANGE_EVENT = "interviewprep:change";

interface Collection<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<T>;
  remove(id: string): Promise<void>;
}

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(items));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (e) {
    console.error("localStorage write failed", e);
  }
}

function localCollection<T extends { id: string }>(key: string): Collection<T> {
  return {
    async list() {
      return read<T>(key);
    },
    async get(id) {
      return read<T>(key).find((i) => i.id === id);
    },
    async put(item) {
      const items = read<T>(key);
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      write(key, items);
      return item;
    },
    async remove(id) {
      write(
        key,
        read<T>(key).filter((i) => i.id !== id),
      );
    },
  };
}

export const db = {
  profiles: localCollection<Profile>("profiles"),
  sessions: localCollection<Session>("sessions"),
  reports: localCollection<Report>("reports"),
  roadmaps: localCollection<Roadmap>("roadmaps"),
  stories: localCollection<Story>("stories"),
  settings: localCollection<Settings>("settings"),
  customPacks: localCollection<Pack>("customPacks"),
  notes: localCollection<Note>("notes"),
  binders: localCollection<Binder>("binders"),
  cortexPages: localCollection<CortexPage>("cortexPages"),
  async clearAll() {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },
  async exportAll() {
    return {
      profiles: read<Profile>("profiles"),
      sessions: read<Session>("sessions"),
      reports: read<Report>("reports"),
      roadmaps: read<Roadmap>("roadmaps"),
      stories: read<Story>("stories"),
      settings: read<Settings>("settings"),
      customPacks: read<Pack>("customPacks"),
      notes: read<Note>("notes"),
      binders: read<Binder>("binders"),
      cortexPages: read<CortexPage>("cortexPages"),
    };
  },
  async importAll(data: Record<string, unknown>) {
    const keys = ["profiles", "sessions", "reports", "roadmaps", "stories", "settings", "customPacks", "notes", "binders", "cortexPages"];
    for (const k of keys) if (Array.isArray(data[k])) write(k, data[k] as unknown[]);
  },
};

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Re-runs `fn` on mount and whenever any collection changes. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  const key = JSON.stringify(deps);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fnRef.current().then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      });
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, load);
    };
  }, [key]);

  return { data, loading };
}

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

/** All packs available to this browser: the built-in library plus anything generated from a job description. */
export function useAllPacks() {
  const { data: custom = [], loading } = useCustomPacks();
  const all = [...PACKS, ...custom];
  return { all, custom, byId: (id: string) => all.find((p) => p.id === id), loading };
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
