import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TERMS_VERSION } from "./auth";
import { StoredProfileSchema } from "./schemas";

// Server-only. The user's data kept in Supabase (plans/auth.md, plans/server-history.md). Every query runs on the
// user-scoped client, so row-level security limits it to the caller's own rows; the explicit
// user_id filters below are a second check, not the only one.

interface CollectionDef<S extends z.ZodType> {
  table: string;
  schema: S;
  /** One item per user (the profile), upserted by user_id; otherwise many, keyed by (user_id, id). */
  single?: boolean;
}

/**
 * Any stored item: an object with a string id. Other fields are kept as sent, so new fields and
 * older clients don't break each other (plans/server-history.md). Size is capped by parseBody (1 MB).
 */
const StoredItemSchema = z.looseObject({ id: z.string().min(1).max(100) });

/** Collections served by /api/db/[collection]; the names match `db.<name>` in lib/db.ts. */
export const USER_COLLECTIONS = {
  profile: { table: "profiles", schema: StoredProfileSchema, single: true },
  sessions: { table: "sessions", schema: StoredItemSchema },
  reports: { table: "reports", schema: StoredItemSchema },
  roadmaps: { table: "roadmaps", schema: StoredItemSchema },
  stories: { table: "stories", schema: StoredItemSchema },
  settings: { table: "settings", schema: StoredItemSchema },
  customPacks: { table: "custom_packs", schema: StoredItemSchema },
  notes: { table: "notes", schema: StoredItemSchema },
  binders: { table: "binders", schema: StoredItemSchema },
  cortexPages: { table: "cortex_pages", schema: StoredItemSchema },
} satisfies Record<string, CollectionDef<z.ZodType>>;

export type UserCollection = keyof typeof USER_COLLECTIONS;

export const isUserCollection = (name: string): name is UserCollection => Object.hasOwn(USER_COLLECTIONS, name);

const isSingle = (c: UserCollection) => "single" in USER_COLLECTIONS[c] && USER_COLLECTIONS[c].single === true;

export async function listItems(supabase: SupabaseClient, collection: UserCollection, userId: string): Promise<unknown[]> {
  const { table } = USER_COLLECTIONS[collection];
  const { data, error } = await supabase.from(table).select("data").eq("user_id", userId);
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return (data ?? []).map((r) => r.data);
}

/**
 * A report belongs to the same org (and assignment) as its session, copied here on the server from
 * the session's stamped columns, so the browser can never put a report in an org (plans/m2-org.md O.4).
 */
async function reportOrg(supabase: SupabaseClient, userId: string, item: { sessionId?: unknown }) {
  if (typeof item.sessionId !== "string") return {};
  const { data, error } = await supabase.from("sessions").select("org_id, assignment_id").eq("user_id", userId).eq("id", item.sessionId).maybeSingle();
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  return data?.org_id ? { org_id: data.org_id, assignment_id: data.assignment_id } : {};
}

export async function putItem(supabase: SupabaseClient, collection: UserCollection, userId: string, item: { id: string }): Promise<void> {
  const { table } = USER_COLLECTIONS[collection];
  const stamp = collection === "reports" ? await reportOrg(supabase, userId, item as { sessionId?: unknown }) : {};
  const { error } = isSingle(collection)
    ? await supabase.from(table).upsert({ user_id: userId, data: item }, { onConflict: "user_id" })
    : await supabase.from(table).upsert({ user_id: userId, id: item.id, data: item, ...stamp }, { onConflict: "user_id,id" });
  if (error) throw new Error(`${table} write failed: ${error.message}`);
}

/** Removes one item, or (single collections, or no id) every item the user has in the collection. */
export async function removeItems(supabase: SupabaseClient, collection: UserCollection, userId: string, id?: string): Promise<void> {
  const { table } = USER_COLLECTIONS[collection];
  let q = supabase.from(table).delete().eq("user_id", userId);
  if (id && !isSingle(collection)) q = q.eq("id", id);
  const { error } = await q;
  if (error) throw new Error(`${table} delete failed: ${error.message}`);
}

/** Records that the user agreed to the current terms, once per TERMS_VERSION. */
export async function ensureTermsConsent(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("consents")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "terms")
    .eq("version", TERMS_VERSION)
    .is("revoked_at", null)
    .limit(1);
  if (error) throw new Error(`consents read failed: ${error.message}`);
  if (data?.length) return;
  const { error: insertError } = await supabase.from("consents").insert({ user_id: userId, kind: "terms", version: TERMS_VERSION, value: {} });
  if (insertError) throw new Error(`consents write failed: ${insertError.message}`);
}
