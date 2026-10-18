import { z } from "zod";

// What each package allows (plans/usage-limits.md). Code asks `checkEntitlement(user, meter)` in
// lib/policies.ts and never checks a package name, so prices, names and numbers stay config (D15).

/** What we count. Strings, not a DB enum: a new meter (e.g. `voice_minutes`) is just a new value. */
export const MeterSchema = z.enum(["mocks", "ai_calls"]);
export type Meter = z.infer<typeof MeterSchema>;

export type Period = "day" | "month" | "none";

export interface Allowance {
  /** null = unlimited. */
  limit: number | null;
  period: Period;
}

export type Package = Partial<Record<Meter, Allowance>>;

/** A meter missing from a package is unlimited. Only `beta` is in use; the others are placeholders. */
export const PACKAGES = {
  beta: { mocks: { limit: 5, period: "day" }, ai_calls: { limit: 150, period: "day" } },
  free: { mocks: { limit: 3, period: "month" }, ai_calls: { limit: 100, period: "month" } },
  pro: { mocks: { limit: null, period: "none" }, ai_calls: { limit: 2000, period: "month" } },
} satisfies Record<string, Package>;

export type PackageId = keyof typeof PACKAGES;

export const isPackageId = (id: string | undefined): id is PackageId => !!id && id in PACKAGES;

// Periods reset on calendar boundaries in India time, so "resets at midnight" is literally true.
// One place to change for per-user time zones later.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** When the current period started and when it ends (null = never, for `none`). */
export function periodWindow(period: Period, now = Date.now()): { startsAt: number; resetsAt: number | null } {
  if (period === "none") return { startsAt: 0, resetsAt: null };
  const ist = new Date(now + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  if (period === "month") return { startsAt: Date.UTC(y, m, 1) - IST_OFFSET_MS, resetsAt: Date.UTC(y, m + 1, 1) - IST_OFFSET_MS };
  const d = ist.getUTCDate();
  return { startsAt: Date.UTC(y, m, d) - IST_OFFSET_MS, resetsAt: Date.UTC(y, m, d + 1) - IST_OFFSET_MS };
}
