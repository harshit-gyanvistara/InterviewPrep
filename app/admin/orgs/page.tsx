"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, PageTitle } from "@/components/Shell";
import { PageSkeleton } from "@/components/Skeleton";
import type { OrgSummary } from "@/lib/orgAdmin";
import { adminFetch, planText } from "./shared";

// Super-admin: every organisation and a form to create one (plans/m2-org.md O.1). The API answers
// 404 to anyone not in SUPER_ADMIN_EMAILS, and this page then says so.

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);

export default function AdminOrgs() {
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", kind: "college", ownerEmail: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrgs((await adminFetch<{ orgs: OrgSummary[] }>("/api/admin/orgs")).orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load organisations.");
    }
  }, []);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const out = await adminFetch<{ id: string; owner: { added: true } | { invited: true; link: string } | null }>("/api/admin/orgs", {
        method: "POST",
        body: { name: form.name, slug: form.slug, kind: form.kind, ...(form.ownerEmail.trim() ? { ownerEmail: form.ownerEmail.trim() } : {}) },
      });
      setNotice(
        out.owner && "link" in out.owner
          ? `Created. ${form.ownerEmail} has no account yet; send them this owner invite (shown once): ${location.origin}${out.owner.link}`
          : out.owner
            ? `Created, with ${form.ownerEmail} as owner.`
            : "Created.",
      );
      setForm({ name: "", slug: "", kind: form.kind, ownerEmail: "" });
      setSlugTouched(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the organisation.");
    } finally {
      setBusy(false);
    }
  };

  if (!orgs && !error) return <PageSkeleton />;
  if (!orgs) return <div className="mx-auto max-w-4xl"><PageTitle title="Organisations" /><Card><p className="text-muted">{error}</p></Card></div>;

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <PageTitle title="Organisations" sub="Create organisations and set their plans. Only super-admins see this page." />

      <Card>
        <h2 className="mb-4 text-sm font-semibold">New organisation</h2>
        <form onSubmit={create} className="grid items-start gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            Name
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })} placeholder="Sunrise Engineering College" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span>Address <span className="text-muted">(build-score.com/org/<b className="font-medium text-ink">address</b>)</span></span>
            <input className="input" required value={form.slug} onChange={(e) => (setSlugTouched(true), setForm({ ...form, slug: slugify(e.target.value) }))} placeholder="sunrise-engineering" />
          </label>
          <label className="grid gap-1.5 text-sm">
            Kind
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {["college", "company", "institute", "bootcamp", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            Owner&apos;s email (optional)
            <input className="input" type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="placement.head@college.edu" />
          </label>
          <div className="sm:col-span-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create organisation"}</button>
          </div>
        </form>
        {notice && <p className="mt-4 break-all rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}
        {error && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">All organisations ({orgs.length})</h2>
        {orgs.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="grid gap-2">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orgs/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 transition hover:bg-soft">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.name}</div>
                    <div className="text-xs text-muted">/{o.slug} · {o.kind} · {o.activeMembers} active member{o.activeMembers === 1 ? "" : "s"}</div>
                  </div>
                  <div className="text-xs text-muted">{planText(o.entitlements)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
