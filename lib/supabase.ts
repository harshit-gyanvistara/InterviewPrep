import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only. The secret key bypasses row-level security and must never reach the browser.
let admin: SupabaseClient | null | undefined;

/**
 * Supabase client with the secret key, or null when SUPABASE_URL / SUPABASE_SECRET_KEY aren't set,
 * so the app keeps working on the code defaults without a database.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return admin;
}
