import type { Entitlement } from "@/lib/schemas";

// Shared by the super-admin pages (plans/m2-org.md O.1).

/** JSON fetch against the admin API; throws the API's own error message. 404 means "not a super-admin". */
export async function adminFetch<T>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 404 && url.endsWith("/api/admin/orgs")) throw new Error("This page is for super-admins only.");
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

const PERIOD: Record<Entitlement["period"], string> = { none: "", day: "/day", month: "/month", year: "/year" };

/** "seats 200 · mocks 1000/month", or "No plan set". */
export const planText = (ents: Entitlement[]) =>
  ents.length ? ents.map((e) => `${e.key} ${e.limit === null ? "unlimited" : e.limit}${PERIOD[e.period]}`).join(" · ") : "No plan set";

/** Common plan keys, offered first in the editor; any other key can be typed. */
export const KNOWN_KEYS = ["seats", "mocks", "ai_calls"];
