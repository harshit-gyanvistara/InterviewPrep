/** Client-side helper for the shared /api/ai/assist endpoint used by Notes and Cortex. */
export async function aiAssist(opts: { mode: "improve" | "generate"; text?: string; instruction?: string; contextTitle?: string }): Promise<string> {
  const res = await fetch("/api/ai/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.html as string;
}
