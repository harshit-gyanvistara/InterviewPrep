// Shared by proxy.ts (server) and the Shell (client); keep it free of heavy imports.

import type { AuthState } from "./db";

/** Pages anyone can open, signed in or not. */
export const PUBLIC_PAGES = ["/welcome", "/sign-in", "/terms", "/privacy"];

/** Full-screen pages without the app nav or the notes button. */
export const isBarePage = (path: string) => PUBLIC_PAGES.includes(path) || path === "/onboarding";

const LEGAL_PAGES = ["/terms", "/privacy"];

/**
 * Where this visitor should be instead of `path`, or null if they may stay. Signed out (accounts
 * on): public pages only. Signed in but not onboarded: onboarding (with AUTH_MODE=off, the landing
 * page first, as before accounts). Onboarded: anything but the landing and sign-in pages.
 */
export function redirectFor(path: string, auth: AuthState, onboarded: boolean): string | null {
  const signedIn = auth.mode === "off" || !!auth.user;
  if (!signedIn) return PUBLIC_PAGES.includes(path) ? null : "/welcome";
  if (!onboarded) {
    if (path === "/onboarding" || LEGAL_PAGES.includes(path)) return null;
    if (auth.mode === "off") return path === "/welcome" ? null : "/welcome";
    return "/onboarding";
  }
  return path === "/welcome" || path === "/sign-in" ? "/" : null;
}
