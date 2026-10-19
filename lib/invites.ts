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

// Join codes: short enough to read out in a class or put on a slide, e.g. "K7QM4-XR2PD". No 0/O, 1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

/** A new reusable join code (about 50 bits), formatted XXXXX-XXXXX, and the hash to store. */
export function newJoinCode(): { code: string; hash: string } {
  const bytes = randomBytes(CODE_LENGTH);
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, hash: hashInviteToken(raw) };
}

/**
 * What to hash for a value from a `/join/<value>` link: a join code is case- and dash-insensitive
 * ("k7qm4 xr2pd" works); a token is used exactly as given.
 */
export function normalizeJoinValue(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return compact.length === CODE_LENGTH && [...compact].every((c) => CODE_ALPHABET.includes(c)) ? compact : value.trim();
}
