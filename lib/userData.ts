import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { TERMS_VERSION } from "./auth";
import { StoredProfileSchema } from "./schemas";

// Server-only. The user's data kept in Supabase (plans/auth.md). Every query runs on the
// user-scoped client, so row-level security limits it to the caller's own rows; the explicit
// user_id filters below are a second check, not the only one.

interface CollectionDef<S extends z.ZodType> {
  table: string;
  schema: S;
}

/**
 * Collections served by /api/db/[collection]. One row per user for now (the profile); the rest of
 * lib/db.ts moves here in M2.2–M2.5 with their own tables.
 */
export const USER_COLLECTIONS = {
  profile: { table: "profiles", schema: StoredProfileSchema },
} satisfies Record<string, CollectionDef<z.ZodType>>;

export type UserCollection = keyof typeof USER_COLLECTIONS;

export const isUserCollection = (name: string): name is UserCollection => Object.hasOwn(USER_COLLECTIONS, name);

export async function listItems(supabase: SupabaseClient, collection: UserCollection, userId: string): Promise<unknown[]> {
  const { table } = USER_COLLECTIONS[collection];
  const { data, error } = await supabase.from(table).select("data").eq("user_id", userId);
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return (data ?? []).map((r) => r.data);
}

export async function putItem(supabase: SupabaseClient, collection: UserCollection, userId: string, item: unknown): Promise<void> {
  const { table } = USER_COLLECTIONS[collection];
  const { error } = await supabase.from(table).upsert({ user_id: userId, data: item }, { onConflict: "user_id" });
  if (error) throw new Error(`${table} write failed: ${error.message}`);
}

export async function removeItems(supabase: SupabaseClient, collection: UserCollection, userId: string): Promise<void> {
  const { table } = USER_COLLECTIONS[collection];
  const { error } = await supabase.from(table).delete().eq("user_id", userId);
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
