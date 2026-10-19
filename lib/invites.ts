import { createHash, randomBytes } from "node:crypto";

// Server-only. Invite tokens (plans/m2-org.md O.2): shown once in the link, stored only as a hash
// (`invites.token_hash`), so a database leak doesn't reveal working invite links.

export const INVITE_DAYS = 14;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new invite token (32 random bytes, URL-safe) and the hash to store. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export const inviteLink = (token: string) => `/join/${token}`;
