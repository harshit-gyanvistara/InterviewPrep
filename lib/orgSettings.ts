import { DEFAULT_SHARE_LEVEL, isShareLevel, type ShareLevel } from "./permissions";

// Client-safe. An organisation's settings (`organizations.settings` JSONB) read with defaults
// (plans/org-ready-schema.md). Server code imports it through lib/policies.ts.

/** Per-org settings with their defaults. `organizations.settings` may hold any subset; unknown keys are ignored here. */
export interface OrgSettings {
  /** Pack ids members may practise; null = every pack. */
  allowedPackIds: string[] | null;
  /** Share level suggested on the join screen; each member still chooses (D11). */
  defaultShareLevel: ShareLevel;
  /** Email domains that may join with a code alone (later: domain SSO, D14). Empty = no domain rule. */
  allowedEmailDomains: string[];
  /** Feature flags, e.g. a future screening mode. Absent = off. */
  features: Record<string, boolean>;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = { allowedPackIds: null, defaultShareLevel: DEFAULT_SHARE_LEVEL, allowedEmailDomains: [], features: {} };

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null);

/** An org's settings read safely: a missing or malformed key falls back to its default, never throws. */
export function orgSettings(org: { settings?: unknown }): OrgSettings {
  const s = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>;
  const flags = s.features && typeof s.features === "object" ? Object.entries(s.features as Record<string, unknown>) : [];
  return {
    allowedPackIds: strings(s.allowedPackIds) ?? DEFAULT_ORG_SETTINGS.allowedPackIds,
    defaultShareLevel: isShareLevel(s.defaultShareLevel) ? s.defaultShareLevel : DEFAULT_ORG_SETTINGS.defaultShareLevel,
    allowedEmailDomains: strings(s.allowedEmailDomains)?.map((d) => d.toLowerCase()) ?? [],
    features: Object.fromEntries(flags.filter((e): e is [string, boolean] => typeof e[1] === "boolean")),
  };
}

