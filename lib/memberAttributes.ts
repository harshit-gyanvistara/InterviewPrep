import type { StudentField } from "./orgSettings";

// Client-safe, pure. The details an org asks members for (branch, year, ...): what an invite may
// pre-fill, and how a member's own answers merge with them on joining (plans/b2b-college.md B.1).

export type Attributes = Record<string, string>;

export const MAX_ATTRIBUTE_LENGTH = 80;

const clean = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_ATTRIBUTE_LENGTH) : "");

/** Keeps only non-empty values for keys the org defined, in the org's field order. */
function pick(fields: StudentField[], values: Attributes): Attributes {
  const out: Attributes = {};
  for (const f of fields) {
    const v = clean(values[f.key]);
    if (v) out[f.key] = v;
  }
  return out;
}

/** Keys an invite may carry that the org hasn't defined. Empty when the invite is fine. */
export function unknownKeys(fields: StudentField[], values: Attributes): string[] {
  const known = new Set(fields.map((f) => f.key));
  return Object.keys(values).filter((k) => !known.has(k));
}

/** An invite's pre-filled values, cut down to the org's current fields (a field removed later drops out). */
export function lockedFor(fields: StudentField[], inviteValues: unknown): Attributes {
  return pick(fields, inviteValues && typeof inviteValues === "object" ? (inviteValues as Attributes) : {});
}

export type Resolved = { ok: true; attributes: Attributes } | { ok: false; missing: StudentField[] };

/**
 * What gets stored on the membership: the invite's values (locked, they always win) plus what the
 * member entered for the other fields. Fails with the required fields still empty.
 */
export function resolveAttributes(fields: StudentField[], locked: Attributes, entered: Attributes): Resolved {
  const attributes = { ...pick(fields, entered), ...pick(fields, locked) };
  const missing = fields.filter((f) => f.required && !attributes[f.key]);
  return missing.length ? { ok: false, missing } : { ok: true, attributes };
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]+/, "").slice(0, 32);

/**
 * Fields from one-per-line text: "Branch*" is required, "Graduation year" is optional. Blank and
 * duplicate lines are skipped. A line whose label matches an `existing` field keeps that field's key,
 * so saving the form never detaches answers members already gave.
 */
export function parseFieldLines(text: string, existing: StudentField[] = []): StudentField[] {
  const out: StudentField[] = [];
  const taken = (key: string) => out.some((f) => f.key === key);
  for (const line of text.split("\n")) {
    const required = line.trim().endsWith("*");
    const label = line.trim().replace(/\*+$/, "").trim().slice(0, 60);
    const key = existing.find((f) => f.label.toLowerCase() === label.toLowerCase())?.key ?? slug(label);
    if (!label || !key || taken(key)) continue;
    out.push({ key, label, required });
  }
  return out.slice(0, 6);
}

/** The inverse of parseFieldLines, for the admin form. */
export const fieldLines = (fields: StudentField[]): string => fields.map((f) => `${f.label}${f.required ? "*" : ""}`).join("\n");
