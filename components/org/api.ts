// Client-side JSON calls for the organisation pages (plans/m2-org.md). Throws the API's own message.

export async function orgApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export const roleLabel = (r: string) => r[0].toUpperCase() + r.slice(1);

/** "due 2 Nov" / "overdue since 2 Nov" / "" for no due date. */
export function dueText(dueAt: string | null): string {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return d.getTime() < Date.now() ? `overdue since ${day}` : `due ${day}`;
}
