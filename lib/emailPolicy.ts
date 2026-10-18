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
