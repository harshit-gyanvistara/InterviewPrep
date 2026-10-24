import { authMode } from "./auth";
import { isSuperAdmin } from "./authz";

// Server-only. A local-development shortcut: sign in as a super-admin without waiting for an email.
// It needs ALL of: DEV_LOGIN=on, a non-production build, accounts switched on, and an email in
// SUPER_ADMIN_EMAILS. Anything else behaves as if the route didn't exist. It still creates a real
// Supabase session (no fake user), so everything after sign-in is the normal code path.

/** Is the shortcut on? Never in production, whatever the environment says. */
export const devLoginEnabled = () => process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "on" && authMode() === "supabase";

/** May this email use it? Only super-admin addresses. */
export const devLoginAllowed = (email: string) => devLoginEnabled() && isSuperAdmin(email);
