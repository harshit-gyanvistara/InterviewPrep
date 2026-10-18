import { PACKAGES, PackageSchema, type Package } from "./packages";
import { getSupabaseAdmin } from "./supabase";

// Server-only. Package allowances from the `packages` table, so a limit can change without a
// deploy (plans/usage-limits.md, phase 1b). Cached briefly because every AI request reads it.

const TTL_MS = 60_000;
let cached: { data: Record<string, Package>; expires: number } | null = null;

async function load(): Promise<Record<string, Package> | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from("packages").select("id, allowances").eq("active", true);
  if (error) throw new Error(`packages read failed: ${error.message}`);
  const out: Record<string, Package> = {};
  for (const row of data ?? []) {
    const parsed = PackageSchema.safeParse(row.allowances);
    if (parsed.success) out[row.id as string] = parsed.data;
    else console.error(JSON.stringify({ event: "packages.invalid", id: row.id, issues: parsed.error.issues.slice(0, 3) }));
  }
  return Object.keys(out).length ? out : null;
}

/** Every active package by id. Falls back to PACKAGES in code when the table is empty, invalid or down. */
export async function getPackages(): Promise<Record<string, Package>> {
  if (cached && Date.now() < cached.expires) return cached.data;
  let data: Record<string, Package> = PACKAGES;
  try {
    data = (await load()) ?? PACKAGES;
  } catch (e) {
    console.error(JSON.stringify({ event: "packages.error", error: e instanceof Error ? e.message : String(e) }));
  }
  cached = { data, expires: Date.now() + TTL_MS };
  return data;
}

/** For tests: forget the cached packages. */
export function resetPackagesCache() {
  cached = null;
}
