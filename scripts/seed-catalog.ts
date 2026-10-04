/**
 * Copies the code defaults (lib/domains, lib/packs) into the Supabase catalog tables.
 *
 *   npm run db:seed              insert rows that don't exist yet; edits made in Supabase are kept
 *   npm run db:seed -- --force   overwrite every row with the code version
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local, and the migration in
 * supabase/migrations applied first.
 */
import { domainToRow, packToRow } from "../lib/catalog-server";
import { DOMAINS } from "../lib/domains";
import { PACKS } from "../lib/packs";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  const force = process.argv.includes("--force");
  const opts = { onConflict: "id", ignoreDuplicates: !force };

  // sort_order keeps the code order (domain inference tries them in this order).
  const domains = await db.from("domains").upsert(DOMAINS.map((d, i) => domainToRow(d, (i + 1) * 10)), opts).select("id");
  if (domains.error) throw domains.error;
  const packs = await db.from("packs").upsert(PACKS.map((p, i) => packToRow(p, (i + 1) * 10)), opts).select("id");
  if (packs.error) throw packs.error;

  const verb = force ? "Wrote" : "Inserted";
  console.log(`${verb} ${domains.data.length}/${DOMAINS.length} domains and ${packs.data.length}/${PACKS.length} packs${force ? "" : " (existing rows left as they are)"}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
