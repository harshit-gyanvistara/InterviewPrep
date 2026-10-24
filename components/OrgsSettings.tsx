"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Card } from "@/components/Shell";
import { useConfirm } from "@/lib/dialogContext";
import { useAuth } from "@/lib/db";
import type { MyOrg } from "@/lib/orgMembership";
import { SHARE_LEVELS, SHARE_LEVEL_TEXT, shareAllows, type ShareLevel } from "@/lib/permissions";

// Settings → Organisations (plans/m2-org.md O.3, D11): the orgs you're in, what each may see of
// your practice, and leaving. Changes take effect straight away.

async function call<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
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

export function OrgsSettings() {
  const { data: auth } = useAuth();
  const confirm = useConfirm();
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrgs((await call<{ orgs: MyOrg[] }>("/api/me/orgs")).orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your organisations.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const changeShare = async (org: MyOrg, shareLevel: ShareLevel) => {
    setOrgs((list) => list?.map((o) => (o.id === org.id ? { ...o, shareLevel } : o)) ?? null);
    setMsg((m) => ({ ...m, [org.id]: "Saving…" }));
    try {
      await call(`/api/orgs/${org.slug}/me`, { method: "PATCH", body: { shareLevel } });
      setMsg((m) => ({ ...m, [org.id]: `Saved. ${org.name} now sees: ${SHARE_LEVEL_TEXT[shareLevel].title.toLowerCase()}.` }));
    } catch (e) {
      setMsg((m) => ({ ...m, [org.id]: e instanceof Error ? e.message : "Couldn't save." }));
      await load();
    }
  };

  const leave = async (org: MyOrg) => {
    const ok = await confirm({
      message: `Leave ${org.name}? It loses access to your practice from now on, and you'll need a new invite to rejoin. Your own history stays with you.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await call(`/api/orgs/${org.slug}/me`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg((m) => ({ ...m, [org.id]: e instanceof Error ? e.message : "Couldn't leave." }));
    }
  };

  if (auth?.mode === "off") return <Card><p className="text-sm text-muted">Organisations need sign-in, which is turned off on this server.</p></Card>;
  if (error) return <Card><p className="text-sm text-muted">{error}</p></Card>;
  if (!orgs) return <Card><p className="text-sm text-muted">Loading…</p></Card>;
  if (orgs.length === 0)
    return (
      <Card>
        <h2 className="mb-1 text-lg font-medium">Organisations</h2>
        <p className="text-sm text-muted">You&apos;re not in any organisation. If your college or company uses Offerly, open the invite link or join code they sent you.</p>
      </Card>
    );

  return (
    <div className="grid gap-4">
      {orgs.map((o) => (
        <Card key={o.id} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent"><Building2 size={18} /></span>
              <div>
                <Link href={`/org/${o.slug}`} className="font-medium hover:underline">{o.name}</Link>
                <div className="text-xs text-muted">{o.role[0].toUpperCase() + o.role.slice(1)}</div>
              </div>
            </div>
            <button className="btn btn-danger" onClick={() => leave(o)}>Leave</button>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">What {o.name} may see of your practice</legend>
            {SHARE_LEVELS.map((l) => {
              const allowed = shareAllows(l, o.minShareLevel);
              return (
              <label key={l} className={`flex gap-3 rounded-xl border p-3 ${allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${o.shareLevel === l ? "border-accent bg-accent-soft" : "border-line"}`}>
                <input type="radio" name={`share-${o.id}`} className="mt-1" checked={o.shareLevel === l} disabled={!allowed} onChange={() => changeShare(o, l)} />
                <span>
                  <span className="block text-sm font-medium">{SHARE_LEVEL_TEXT[l].title}</span>
                  <span className="block text-sm text-muted">{SHARE_LEVEL_TEXT[l].body}</span>
                </span>
              </label>
              );
            })}
            {o.minShareLevel !== "activity" && <p className="text-xs text-muted">{o.name} requires at least &quot;{SHARE_LEVEL_TEXT[o.minShareLevel].title}&quot;. Practice you do as yourself (not for {o.name}) stays private.</p>}
          </fieldset>
          {msg[o.id] && <p className="text-sm text-muted">{msg[o.id]}</p>}
        </Card>
      ))}
    </div>
  );
}
