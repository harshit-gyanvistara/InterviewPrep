import { DEFAULT_CATALOG, type Catalog } from "./catalog";
import type { DomainProfile } from "./domains";
import { isValidPack } from "./packs";
import { getSupabaseAdmin } from "./supabase";
import { ROUND_TYPES, type Pack } from "./types";

// Server-only: reads the catalog tables with the secret key.

export interface DomainRow {
  id: string;
  label: string;
  match_pattern: string | null;
  interviewer_context: string;
  scoring_context: string;
  round_hints: string;
  roadmap_hints: string;
  allows_coding: boolean;
  version: number;
  sort_order: number;
}

export interface PackRow {
  id: string;
  title: string;
  company: string;
  role: string;
  round_type: string;
  description: string;
  duration_min: number;
  topics: string[];
  rubric: string[];
  style: string;
  domains: string[] | null;
  sort_order: number;
}

export const domainToRow = (d: DomainProfile, sortOrder: number): DomainRow => ({
  id: d.id,
  label: d.label,
  match_pattern: d.match ?? null,
  interviewer_context: d.interviewerContext,
  scoring_context: d.scoringContext,
  round_hints: d.roundHints,
  roadmap_hints: d.roadmapHints,
  allows_coding: d.allowsCoding,
  version: d.version,
  sort_order: sortOrder,
});

const rowToDomain = (r: DomainRow): DomainProfile => ({
  id: r.id,
  label: r.label,
  match: r.match_pattern ?? undefined,
  interviewerContext: r.interviewer_context,
  scoringContext: r.scoring_context,
  roundHints: r.round_hints,
  roadmapHints: r.roadmap_hints,
  allowsCoding: r.allows_coding,
  version: r.version,
});

export const packToRow = (p: Pack, sortOrder: number): PackRow => ({
  id: p.id,
  title: p.title,
  company: p.company,
  role: p.role,
  round_type: p.roundType,
  description: p.description,
  duration_min: p.durationMin,
  topics: p.topics,
  rubric: p.rubric,
  style: p.style,
  domains: p.domains === "all" ? null : p.domains,
  sort_order: sortOrder,
});

const rowToPack = (r: PackRow): Pack => ({
  id: r.id,
  title: r.title,
  company: r.company,
  role: r.role,
  roundType: r.round_type as Pack["roundType"],
  description: r.description,
  durationMin: r.duration_min,
  topics: r.topics,
  rubric: r.rubric,
  style: r.style,
  domains: r.domains ?? "all",
});

const TTL_MS = 5 * 60_000;
const RETRY_MS = 30_000;
let cached: { data: Catalog; expires: number } | null = null;
let inflight: Promise<Catalog> | null = null;

/**
 * The catalog, cached in memory for 5 minutes so interview turns don't wait on the database.
 * An edit in Supabase reaches new requests within that window. Falls back to the code defaults
 * (retrying after 30s) when Supabase isn't configured, is empty, or errors.
 */
export function getCatalog(): Promise<Catalog> {
  if (cached && Date.now() < cached.expires) return Promise.resolve(cached.data);
  inflight ??= load()
    .then(({ data, ok }) => {
      cached = { data, expires: Date.now() + (ok ? TTL_MS : RETRY_MS) };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function load(): Promise<{ data: Catalog; ok: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { data: DEFAULT_CATALOG, ok: true };
  try {
    const [d, p] = await Promise.all([
      db.from("domains").select("*").eq("active", true).order("sort_order"),
      db.from("packs").select("*").eq("active", true).order("sort_order"),
    ]);
    if (d.error) throw d.error;
    if (p.error) throw p.error;
    const domains = (d.data as DomainRow[]).map(rowToDomain);
    const packs = (p.data as PackRow[]).map(rowToPack).filter((pk) => {
      const ok = isValidPack(pk) && (ROUND_TYPES as readonly string[]).includes(pk.roundType);
      if (!ok) console.warn(`catalog: skipping invalid pack "${pk.id}"`);
      return ok;
    });
    if (!domains.length || !packs.length) {
      console.warn("catalog: Supabase tables are empty, using code defaults. Run `npm run db:seed`.");
      return { data: DEFAULT_CATALOG, ok: false };
    }
    return { data: { domains, packs }, ok: true };
  } catch (e) {
    console.error("catalog: Supabase read failed, using code defaults:", e instanceof Error ? e.message : e);
    return { data: DEFAULT_CATALOG, ok: false };
  }
}
