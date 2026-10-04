import { DOMAINS, type DomainProfile } from "./domains";
import { PACKS } from "./packs";
import type { Pack } from "./types";

/**
 * Data every user reads and only Offerly staff edit: the fields (domains) and the built-in pack
 * library. The live copy is in Supabase (lib/catalog-server.ts, served by /api/catalog); the code
 * copy below seeds the database and is the fallback when it isn't configured or reachable.
 */
export interface Catalog {
  domains: DomainProfile[];
  packs: Pack[];
}

export const DEFAULT_CATALOG: Catalog = { domains: DOMAINS, packs: PACKS };
