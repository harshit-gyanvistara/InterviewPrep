"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { PageSkeleton } from "@/components/Skeleton";
import type { OrgDetail } from "@/lib/orgAdmin";
import { SHARE_LEVELS } from "@/lib/permissions";
import { orgSettings } from "@/lib/orgSettings";
import { ENTITLEMENT_PERIODS, type Entitlement } from "@/lib/schemas";
import { KNOWN_KEYS, adminFetch } from "../shared";

// Super-admin: one organisation (plans/m2-org.md O.1). Its plan (entitlement rows), settings and
// owners, plus who's in it and the org's audit log. Marketing sets plans here, never in SQL.

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

export default function AdminOrg() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Entitlement[]>([]);
  const [basics, setBasics] = useState({ name: "", kind: "" });
  const [settings, setSettings] = useState({ allowedPackIds: "", defaultShareLevel: "scores", allowedEmailDomains: "", features: "" });
  const [ownerEmail, setOwnerEmail] = useState("");

  const load = useCallback(async () => {
    try {
      const { org: o } = await adminFetch<{ org: OrgDetail }>(`/api/admin/orgs/${id}`);
      setOrg(o);
      setPlan(o.entitlements);
      setBasics({ name: o.name, kind: o.kind });
      const s = orgSettings(o);
      setSettings({
        allowedPackIds: s.allowedPackIds?.join(", ") ?? "",
        defaultShareLevel: s.defaultShareLevel,
        allowedEmailDomains: s.allowedEmailDomains.join(", "),
        features: Object.entries(s.features).filter(([, on]) => on).map(([k]) => k).join(", "),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the organisation.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a save, shows its result next to the section, and reloads the org. */
  const save = async (section: string, fn: () => Promise<string | void>) => {
    setMsg((m) => ({ ...m, [section]: "Saving…" }));
    try {
      const done = await fn();
      setMsg((m) => ({ ...m, [section]: done || "Saved." }));
      await load();
    } catch (e) {
      setMsg((m) => ({ ...m, [section]: e instanceof Error ? e.message : "Couldn't save." }));
    }
  };

  if (!org && !error) return <PageSkeleton />;
  if (!org) return <div className="mx-auto max-w-4xl"><PageTitle title="Organisation" /><Card><p className="text-muted">{error}</p></Card></div>;

  const note = (k: string) => msg[k] && <p className="text-sm text-muted break-all">{msg[k]}</p>;

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/admin/orgs" className="text-muted hover:text-ink">← All organisations</Link>
          <Link href={`/org/${org.slug}`} className="text-accent hover:underline">Open the organisation&apos;s page →</Link>
        </div>
        <PageTitle title={org.name} sub={`/${org.slug} · ${org.kind} · ${org.activeMembers} active member${org.activeMembers === 1 ? "" : "s"}`} />
      </div>

      <Section title="Plan" hint="What this organisation can use. Set per deal; leave the limit empty for unlimited.">
        <div className="grid gap-2">
          {plan.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <input className="input" list="plan-keys" aria-label="Key" value={e.key} onChange={(ev) => setPlan(plan.map((x, j) => (j === i ? { ...x, key: ev.target.value.trim().toLowerCase() } : x)))} />
              <input
                className="input"
                aria-label="Limit"
                inputMode="numeric"
                placeholder="unlimited"
                value={e.limit ?? ""}
                onChange={(ev) => setPlan(plan.map((x, j) => (j === i ? { ...x, limit: ev.target.value.trim() === "" ? null : Math.max(0, Math.floor(Number(ev.target.value) || 0)) } : x)))}
              />
              <select className="input" aria-label="Period" value={e.period} onChange={(ev) => setPlan(plan.map((x, j) => (j === i ? { ...x, period: ev.target.value as Entitlement["period"] } : x)))}>
                {ENTITLEMENT_PERIODS.map((p) => <option key={p} value={p}>{p === "none" ? "in total" : `per ${p}`}</option>)}
              </select>
              <button className="btn btn-ghost" aria-label={`Remove ${e.key || "row"}`} onClick={() => setPlan(plan.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
          <datalist id="plan-keys">{KNOWN_KEYS.map((k) => <option key={k} value={k} />)}</datalist>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => setPlan([...plan, { key: KNOWN_KEYS.find((k) => !plan.some((p) => p.key === k)) ?? "", limit: null, period: "none" }])}><Plus size={15} /> Add limit</button>
          <button className="btn btn-primary" onClick={() => save("plan", () => adminFetch(`/api/admin/orgs/${id}/entitlements`, { method: "PUT", body: { entitlements: plan } }).then(() => "Plan saved."))}>Save plan</button>
        </div>
        {note("plan")}
      </Section>

      <Section title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">Name<input className="input" value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} /></label>
          <label className="grid gap-1.5 text-sm">Kind<input className="input" value={basics.kind} onChange={(e) => setBasics({ ...basics, kind: e.target.value })} /></label>
        </div>
        <div><button className="btn btn-primary" onClick={() => save("basics", () => adminFetch(`/api/admin/orgs/${id}`, { method: "PATCH", body: basics }).then(() => {}))}>Save details</button></div>
        {note("basics")}
      </Section>

      <Section title="Settings" hint="Blank means no restriction.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">Allowed rounds (pack ids, comma-separated)<input className="input" value={settings.allowedPackIds} onChange={(e) => setSettings({ ...settings, allowedPackIds: e.target.value })} placeholder="every round" /></label>
          <label className="grid gap-1.5 text-sm">
            Default sharing on join
            <select className="input" value={settings.defaultShareLevel} onChange={(e) => setSettings({ ...settings, defaultShareLevel: e.target.value })}>
              {SHARE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">Allowed email domains<input className="input" value={settings.allowedEmailDomains} onChange={(e) => setSettings({ ...settings, allowedEmailDomains: e.target.value })} placeholder="college.edu" /></label>
          <label className="grid gap-1.5 text-sm">Features on (comma-separated)<input className="input" value={settings.features} onChange={(e) => setSettings({ ...settings, features: e.target.value })} placeholder="none" /></label>
        </div>
        <div>
          <button
            className="btn btn-primary"
            onClick={() =>
              save("settings", () =>
                adminFetch(`/api/admin/orgs/${id}`, {
                  method: "PATCH",
                  body: {
                    // Keeps keys this form doesn't edit.
                    settings: {
                      ...org.settings,
                      allowedPackIds: list(settings.allowedPackIds).length ? list(settings.allowedPackIds) : null,
                      defaultShareLevel: settings.defaultShareLevel,
                      allowedEmailDomains: list(settings.allowedEmailDomains).map((d) => d.replace(/^@/, "").toLowerCase()),
                      features: Object.fromEntries(list(settings.features).map((f) => [f, true])),
                    },
                  },
                }).then(() => {}),
              )
            }
          >
            Save settings
          </button>
        </div>
        {note("settings")}
      </Section>

      <Section title="People" hint="Owners and admins invite everyone else from the organisation page.">
        {org.people.length === 0 ? (
          <p className="text-sm text-muted">No members yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {org.people.map((p) => (
              <li key={p.userId} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0">
                <span className="truncate">{p.email ?? p.userId}</span>
                <span className="text-muted">{p.role}{p.status !== "active" ? ` · ${p.status}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {org.pendingInvites.length > 0 && (
          <div className="text-sm">
            <div className="mb-1 font-medium">Pending invites</div>
            {org.pendingInvites.map((i) => (
              <div key={i.id} className="text-muted">{i.email ?? "join code"} · {i.role}{i.expiresAt ? ` · expires ${new Date(i.expiresAt).toLocaleDateString()}` : ""}</div>
            ))}
          </div>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save("owner", async () => {
              const out = await adminFetch<{ added: true } | { invited: true; link: string }>(`/api/admin/orgs/${id}/owners`, { method: "POST", body: { email: ownerEmail.trim() } });
              setOwnerEmail("");
              return "link" in out ? `No account yet. Send this owner invite (shown once): ${location.origin}${out.link}` : "Added as owner.";
            });
          }}
        >
          <input className="input max-w-xs" type="email" required placeholder="owner@college.edu" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <button className="btn btn-ghost">Add owner</button>
        </form>
        {note("owner")}
      </Section>

      <Section title="Audit log" hint="Latest 50 actions on this organisation.">
        {org.audit.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {org.audit.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5 last:border-0">
                <span>{a.action}</span>
                <span className="text-muted">{a.actorEmail ?? "system"} · {new Date(a.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
