import { disposableEmailBlocklistSet } from "disposable-email-domains-js";

// Throwaway inboxes (yopmail, mailinator, …) can't sign in: anyone can read them, so they'd let one
// person farm free accounts. The list comes from the disposable-email-domains project; extra domains
// can be added per deployment with BLOCKED_EMAIL_DOMAINS (comma-separated), without a release.
const disposable = disposableEmailBlocklistSet();

function extraBlocked(): Set<string> {
  return new Set(
    (process.env.BLOCKED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const BETA_CLOSED_MESSAGE = "Offerly is in private beta. Ask the team for an invite.";

/**
 * Private beta: when BETA_ALLOWED_EMAILS is set (comma-separated emails and/or "@domain" entries),
 * only those addresses may sign in or use AI. Empty or unset means open to everyone.
 */
export function isBetaAllowed(email: string | null | undefined): boolean {
  const entries = (process.env.BETA_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return true;
  if (!email) return false;
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@"));
  return entries.includes(address) || entries.includes(domain);
}

/** True when the address's domain, or any parent of it (e.g. x.yopmail.com), is blocked. */
export function isBlockedEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  if (!domain) return false;
  const extra = extraBlocked();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (disposable.has(candidate) || extra.has(candidate)) return true;
  }
  return false;
}
