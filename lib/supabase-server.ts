import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Server-only. The user-scoped Supabase client (plans/auth.md A4/A5): publishable key + the
// signed-in user's session cookie, so row-level security decides what each query can touch.
// The secret-key client for the catalog and admin jobs stays in lib/supabase.ts.

/** Project URL and publishable key, or null when Supabase isn't configured. */
export function supabasePublicConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/**
 * A client bound to this request's cookies. Session refreshes and sign-in/out write cookies back
 * through `cookies()`, which works in route handlers; in a Server Component the write is ignored
 * (proxy.ts refreshes the session before rendering, so nothing is lost).
 */
export async function getSupabaseForRequest(): Promise<SupabaseClient> {
  const config = supabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
        }
      },
    },
  });
}
