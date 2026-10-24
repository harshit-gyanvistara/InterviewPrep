import { DEFAULT_SHARE_LEVEL, isShareLevel, type ShareLevel } from "./permissions";

// Client-safe. An organisation's settings (`organizations.settings` JSONB) read with defaults
// (plans/org-ready-schema.md). Server code imports it through lib/policies.ts.

/** A detail the org asks each member for when they join (branch, year, ...). Stored on the membership. */
export interface StudentField {
  key: string;
  label: string;
  required: boolean;
}

export const STUDENT_FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_STUDENT_FIELDS = 6;

/** Per-org settings with their defaults. `organizations.settings` may hold any subset; unknown keys are ignored here. */
export interface OrgSettings {
  /** Details asked on joining, in order. A value the invite already carries is filled in and locked. */
  studentFields: StudentField[];
  /** Pack ids members may practise; null = every pack. */
  allowedPackIds: string[] | null;
  /** Share level suggested on the join screen; each member still chooses (D11). */
  defaultShareLevel: ShareLevel;
  /** The least a member may share with this org ("activity" = no minimum). Applies when joining and when changing it later. */
  minShareLevel: ShareLevel;
  /** Email domains that may join with a code alone (later: domain SSO, D14). Empty = no domain rule. */
  allowedEmailDomains: string[];
  /** Feature flags, e.g. a future screening mode. Absent = off. */
  features: Record<string, boolean>;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = { studentFields: [], allowedPackIds: null, defaultShareLevel: DEFAULT_SHARE_LEVEL, minShareLevel: "activity", allowedEmailDomains: [], features: {} };

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null);

/** Valid, de-duplicated fields only; anything malformed is dropped rather than failing the whole settings read. */
function studentFields(v: unknown): StudentField[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: StudentField[] = [];
  for (const f of v) {
    if (!f || typeof f !== "object") continue;
    const { key, label, required } = f as Record<string, unknown>;
    if (typeof key !== "string" || !STUDENT_FIELD_KEY.test(key) || seen.has(key)) continue;
    if (typeof label !== "string" || !label.trim() || label.length > 60) continue;
    seen.add(key);
    out.push({ key, label: label.trim(), required: required === true });
    if (out.length === MAX_STUDENT_FIELDS) break;
  }
  return out;
}

/** An org's settings read safely: a missing or malformed key falls back to its default, never throws. */
export function orgSettings(org: { settings?: unknown }): OrgSettings {
  const s = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>;
  const flags = s.features && typeof s.features === "object" ? Object.entries(s.features as Record<string, unknown>) : [];
  return {
    studentFields: studentFields(s.studentFields),
    allowedPackIds: strings(s.allowedPackIds) ?? DEFAULT_ORG_SETTINGS.allowedPackIds,
    defaultShareLevel: isShareLevel(s.defaultShareLevel) ? s.defaultShareLevel : DEFAULT_ORG_SETTINGS.defaultShareLevel,
    minShareLevel: isShareLevel(s.minShareLevel) ? s.minShareLevel : DEFAULT_ORG_SETTINGS.minShareLevel,
    allowedEmailDomains: strings(s.allowedEmailDomains)?.map((d) => d.toLowerCase()) ?? [],
    features: Object.fromEntries(flags.filter((e): e is [string, boolean] => typeof e[1] === "boolean")),
  };
}

