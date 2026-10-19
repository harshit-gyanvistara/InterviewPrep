"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Copy, Download, KeyRound, Mail } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { PageSkeleton } from "@/components/Skeleton";
import { useConfirm } from "@/lib/dialogContext";
import type { InviteView } from "@/lib/orgInvites";
import type { Permission } from "@/lib/permissions";

// An organisation's own page (plans/m2-org.md). For now: invites and join codes for people who can
// manage members (O.2). Members, cohorts, assignments and analytics join it in O.5–O.6.

interface OrgInfo {
  org: { id: string; name: string; slug: string };
  permissions: Permission[];
}

type Created = { email: string | null; link: string; code?: string };

const EMAIL_RE = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;
/** Every email address in pasted text: one per line, comma-separated, or a CSV export with other columns. */
const emailsIn = (text: string) => [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
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

const roleLabel = (r: string) => r[0].toUpperCase() + r.slice(1);

export default function OrgHome() {
  const { slug } = useParams<{ slug: string }>();
  const confirm = useConfirm();
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("member");
  const [codeRole, setCodeRole] = useState("member");
  const [maxUses, setMaxUses] = useState("");
  const [created, setCreated] = useState<Created[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = !!info?.permissions.includes("members.manage");
  const roles = ["member", "coach", "admin", ...(info?.permissions.includes("org.billing") ? ["owner"] : [])];

  const load = useCallback(async () => {
    try {
      const i = await api<OrgInfo>(`/api/orgs/${slug}`);
      setInfo(i);
      if (i.permissions.includes("members.manage")) setInvites((await api<{ invites: InviteView[] }>(`/api/orgs/${slug}/invites`)).invites);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the organisation.");
    }
  }, [slug]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await api<{ invites: Created[] }>(`/api/orgs/${slug}/invites`, { method: "POST", body });
      setCreated(out.invites.map((i) => ({ ...i, link: `${location.origin}${i.link}` })));
      setEmails("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't create invites.");
    } finally {
      setBusy(false);
    }
  };

  const found = emailsIn(emails);

  const downloadCsv = () => {
    const rows = [["email", "invite link"], ...created.map((c) => [c.email ?? "", c.link])];
    const blob = new Blob([rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${slug}-invites.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const revoke = async (i: InviteView) => {
    if (!(await confirm({ message: `Revoke this ${i.kind === "code" ? "join code" : `invite for ${i.email}`}? The link stops working straight away.`, danger: true }))) return;
    try {
      await api(`/api/orgs/${slug}/invites/${i.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't revoke.");
    }
  };

  if (!info && !error) return <PageSkeleton />;
  if (!info) return <div className="mx-auto max-w-4xl"><PageTitle title="Organisation" /><Card><p className="text-muted">{error}</p></Card></div>;

  if (!canManage)
    return (
      <div className="mx-auto max-w-4xl">
        <PageTitle title={info.org.name} sub="You're a member of this organisation." />
        <Card><p className="text-sm text-muted">Assignments from your organisation will show here and on your dashboard soon. Until then, practise as usual.</p></Card>
      </div>
    );

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <PageTitle title={info.org.name} sub="Invite people to practise with Offerly. Each person who joins uses one seat." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="grid content-start gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Mail size={16} /> Invite by email</h2>
          <p className="text-sm text-muted">Paste addresses, one per line or comma-separated, or a CSV export. Each person gets their own link that only works for their address.</p>
          <textarea className="input min-h-28" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={"asha@college.edu\nravi@college.edu"} />
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <button className="btn btn-primary" disabled={busy || found.length === 0} onClick={() => create({ kind: "email", emails: found, role })}>
              {found.length ? `Create ${found.length} invite${found.length === 1 ? "" : "s"}` : "Create invites"}
            </button>
          </div>
        </Card>

        <Card className="grid content-start gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={16} /> Join code</h2>
          <p className="text-sm text-muted">One code for a whole class or team: share it on a slide or in a group. Valid for 14 days.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={codeRole} onChange={(e) => setCodeRole(e.target.value)} aria-label="Role for the code">
              {roles.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <input className="input w-36" inputMode="numeric" placeholder="Any number of uses" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} aria-label="Maximum uses" />
            <button className="btn btn-primary" disabled={busy} onClick={() => create({ kind: "code", role: codeRole, maxUses: maxUses ? Number(maxUses) : null })}>Create code</button>
          </div>
        </Card>
      </div>

      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}

      {created.length > 0 && (
        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">New {created[0].code ? "join code" : "invite links"}: copy them now, they won&apos;t be shown again</h2>
            {!created[0].code && <button className="btn btn-ghost" onClick={downloadCsv}><Download size={15} /> Download CSV</button>}
          </div>
          <ul className="grid gap-2">
            {created.map((c) => (
              <li key={c.link} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{c.code ? <b className="tracking-widest">{c.code}</b> : c.email}<span className="ml-2 text-muted">{c.link}</span></span>
                <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(c.code ? `${c.link}\nCode: ${c.code}` : c.link)} aria-label="Copy"><Copy size={14} /> Copy</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Open invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className="min-w-0 truncate">{i.kind === "code" ? "Join code" : i.email} · {roleLabel(i.role)}</span>
                <span className="flex items-center gap-3 text-muted">
                  {i.kind === "code" && <span>{i.uses}{i.maxUses ? ` of ${i.maxUses}` : ""} used</span>}
                  {i.expiresAt && <span>until {new Date(i.expiresAt).toLocaleDateString()}</span>}
                  <button className="text-danger hover:underline" onClick={() => revoke(i)}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
