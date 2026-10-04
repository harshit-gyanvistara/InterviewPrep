import type { Profile } from "../types";
import { general } from "./general";
import { medical } from "./medical";
import { software } from "./software";

/**
 * A field the candidate is preparing for (medicine, software, …). It feeds every prompt that
 * should change with the field, so the prompts stay general and the field-specific knowledge
 * lives here as data.
 *
 * The live copy lives in the Supabase `domains` table (see lib/catalog-server.ts). The profiles in
 * this folder are the seed for that table (scripts/seed-catalog.ts) and the fallback when the
 * database isn't configured or can't be reached. Later an organisation (e.g. a medical college)
 * sets the domain for all its members; see plans/domain-prompts-and-caching.md.
 */
export interface DomainProfile {
  /** Stable id stored on profiles (and later on orgs). Validated against the catalog, not a DB enum. */
  id: string;
  label: string;
  /** Regex source, matched case-insensitively against target role, then job description, to guess the field. */
  match?: string;
  /** Interview norms for this field, given to the interviewer. Empty = no field block. */
  interviewerContext: string;
  /** Extra rules for the scorer. */
  scoringContext: string;
  /** Which kinds of rounds fit this field, for pack generation. */
  roundHints: string;
  /** Extra guidance for the prep roadmap. */
  roadmapHints: string;
  /** Whether programming rounds make sense for this field. */
  allowsCoding: boolean;
  /** Bump when any text above changes, so sessions can record which version they used. */
  version: number;
}

/** Code defaults. Order matters for inference: the first profile whose `match` hits wins. */
export const DOMAINS: DomainProfile[] = [medical, software, general];

export const DEFAULT_DOMAIN_ID = general.id;

export const getDomain = (id: string | undefined, domains: DomainProfile[] = DOMAINS) => domains.find((d) => d.id === id);

const patterns = new Map<string, RegExp | null>();
function matches(domain: DomainProfile, text: string): boolean {
  if (!domain.match || !text.trim()) return false;
  if (!patterns.has(domain.match)) {
    try {
      patterns.set(domain.match, new RegExp(domain.match, "i"));
    } catch {
      patterns.set(domain.match, null); // a bad pattern edited in the database just never matches
    }
  }
  return patterns.get(domain.match)?.test(text) ?? false;
}

/**
 * Guesses the field. The target role is checked first so that, say, a software engineer whose
 * job description mentions a hospital still lands in software; the job description is the tiebreak.
 */
export function inferDomain(profile: Pick<Profile, "targetRole" | "jobDescription">, domains: DomainProfile[] = DOMAINS): DomainProfile {
  const byText = (text: string) => domains.find((d) => matches(d, text));
  return byText(profile.targetRole) ?? byText(profile.jobDescription ?? "") ?? getDomain(DEFAULT_DOMAIN_ID, domains) ?? general;
}

/**
 * The domain a request should use. Precedence: the org's domain (once orgs exist) → the
 * domain the user picked → a guess from their role and job description → general.
 */
export function resolveDomain(
  profile: Pick<Profile, "targetRole" | "jobDescription" | "domain">,
  orgDomainId?: string,
  domains: DomainProfile[] = DOMAINS,
): DomainProfile {
  return getDomain(orgDomainId, domains) ?? getDomain(profile.domain, domains) ?? inferDomain(profile, domains);
}
