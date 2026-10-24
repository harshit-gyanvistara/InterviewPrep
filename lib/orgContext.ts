// Client-safe, pure. What an organisation wants its interviews to reflect (plans/b2b-college.md B.8):
// the companies and roles it prepares people for, the tech stack, and free notes. It can be set for the
// whole org and refined per section; the more specific one wins field by field.

export const CONTEXT_KEYS = ["companies", "roles", "techStack", "notes"] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type ContextFields = Record<ContextKey, string>;

export const CONTEXT_MAX_CHARS = 1500;

export const CONTEXT_LABELS: Record<ContextKey, { label: string; hint: string }> = {
  companies: { label: "Companies you prepare people for", hint: "TCS, Infosys, Wipro, Amazon" },
  roles: { label: "Roles", hint: "Software engineer trainee, data analyst" },
  techStack: { label: "Tech stack and tools", hint: "Java, SQL, Spring, AWS basics" },
  notes: { label: "Anything else the interviewer should know", hint: "Weigh communication heavily. Students are final-year, so expect fresher-level depth." },
};

export const emptyContext = (): ContextFields => ({ companies: "", roles: "", techStack: "", notes: "" });

/** Any stored value read safely: only known string fields, trimmed and capped. */
export function readContext(value: unknown): ContextFields {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = emptyContext();
  for (const k of CONTEXT_KEYS) out[k] = typeof v[k] === "string" ? v[k].trim().slice(0, CONTEXT_MAX_CHARS) : "";
  return out;
}

export const hasContext = (c: ContextFields) => CONTEXT_KEYS.some((k) => c[k].trim() !== "");

export interface MergedContext extends ContextFields {
  orgName: string;
}

/**
 * Layers from least to most specific (the org, then each section from the top down). Per field, the
 * last non-empty value wins. Null when nothing is set anywhere, so interviews carry no context at all.
 */
export function mergeContext(orgName: string, layers: unknown[]): MergedContext | null {
  const merged = emptyContext();
  for (const layer of layers) {
    const c = readContext(layer);
    for (const k of CONTEXT_KEYS) if (c[k]) merged[k] = c[k];
  }
  return hasContext(merged) ? { orgName: orgName.trim().slice(0, 120), ...merged } : null;
}
