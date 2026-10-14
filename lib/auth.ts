import { ApiError } from "./liveAgent";
import { getSupabaseForRequest, supabasePublicConfig } from "./supabase-server";

// Server-only. Who is making this request (plans/auth.md). The only place that knows about
// AUTH_MODE; routes call `requireUser()` and get a user or a 401.
//
//   supabase  Supabase Auth session cookies. The default whenever SUPABASE_URL and
//             SUPABASE_PUBLISHABLE_KEY are set.
//   off       No accounts: every request is LOCAL_USER, so the app runs with no Supabase project
//             (local work, CI). Never allowed in production: there, routes fail closed with 503.

export type AuthMode = "supabase" | "off";

export interface AuthUser {
  id: string;
  email: string | null;
}

export const LOCAL_USER: AuthUser = { id: "local", email: null };

/** Bump when the terms or privacy text changes; sign-in records the version the user agreed to. */
export const TERMS_VERSION = "2026-10-14-draft";

export function authMode(): AuthMode {
  const explicit = process.env.AUTH_MODE;
  if (explicit === "off" || explicit === "supabase") return explicit;
  return supabasePublicConfig() ? "supabase" : "off";
}

/** Google sign-in is offered only when the provider is switched on in the Supabase project too. */
export const googleEnabled = () => authMode() === "supabase" && process.env.AUTH_GOOGLE === "on";

function assertUsable(mode: AuthMode) {
  if (mode === "off" && process.env.NODE_ENV === "production") {
    throw new ApiError(503, "Sign-in is not configured on this server.");
  }
  if (mode === "supabase" && !supabasePublicConfig()) {
    throw new ApiError(503, "AUTH_MODE=supabase needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
  }
}

/** The signed-in user, or null. Verifies the session JWT (getClaims), not just the cookie's presence. */
export async function getUser(): Promise<AuthUser | null> {
  const mode = authMode();
  assertUsable(mode);
  if (mode === "off") return LOCAL_USER;

  const supabase = await getSupabaseForRequest();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/** The signed-in user, or ApiError 401. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) throw new ApiError(401, "Sign in to continue.");
  return user;
}
