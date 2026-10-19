// Shared by proxy.ts (server) and the Shell (client); keep it free of heavy imports.

import type { AuthState } from "./db";

/** Pages anyone can open, signed in or not. */
export const PUBLIC_PAGES = ["/welcome", "/sign-in", "/terms", "/privacy"];

/** Invite links (plans/m2-org.md O.2): open to everyone, so a signed-out invitee sees what to do. */
export const isJoinPage = (path: string) => path.startsWith("/join/");

/** Full-screen pages without the app nav or the notes button. */
export const isBarePage = (path: string) => PUBLIC_PAGES.includes(path) || path === "/onboarding" || isJoinPage(path);

/** An invite opened while signed out is kept here, and resumed once the person has signed in. */
export const PENDING_JOIN_KEY = "offerly.pendingJoin";

const LEGAL_PAGES = ["/terms", "/privacy"];

/**
 * Where this visitor should be instead of `path`, or null if they may stay. Signed out (accounts
 * on): public pages only. Signed in but not onboarded: onboarding (with AUTH_MODE=off, the landing
 * page first, as before accounts). Onboarded: anything but the landing and sign-in pages.
 * Invite pages are open to all; a pending invite (opened while signed out) comes first after sign-in.
 */
export function redirectFor(path: string, auth: AuthState, onboarded: boolean, pendingJoin: string | null = null): string | null {
  const signedIn = auth.mode === "off" || !!auth.user;
  if (isJoinPage(path)) return null;
  if (!signedIn) return PUBLIC_PAGES.includes(path) ? null : "/welcome";
  // Back from sign-in with an invite waiting: finish joining before onboarding or anything else.
  if (pendingJoin && auth.mode !== "off") return `/join/${encodeURIComponent(pendingJoin)}`;
  if (!onboarded) {
    if (path === "/onboarding" || LEGAL_PAGES.includes(path)) return null;
    if (auth.mode === "off") return path === "/welcome" ? null : "/welcome";
    return "/onboarding";
  }
  return path === "/welcome" || path === "/sign-in" ? "/" : null;
}
