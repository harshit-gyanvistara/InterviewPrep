"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/Shell";
import { useConfirm } from "@/lib/dialogContext";
import { useCatalog, useOrgPacks } from "@/lib/db";
import type { AssignmentView, CohortView, GroupView } from "@/lib/orgCohorts";
import { dueText, orgApi } from "./api";

// Setting and tracking assignments (plans/m2-org.md O.5). For people with assignments.create;
// a coach placed in a cohort can only pick that cohort or a section below it (the server checks
// too). Admins can also pick a group (plans/b2b-college.md B.2).

/** The audience select's values: "" everyone, "c:<cohort id>", "g:<group id>". */
const audience = (v: string) => ({ cohortId: v.startsWith("c:") ? v.slice(2) : null, groupId: v.startsWith("g:") ? v.slice(2) : null });

export function AssignmentsPanel({ slug, orgId, coachCohortId }: { slug: string; orgId: string; coachCohortId: string | null }) {
  const confirm = useConfirm();
  const { catalog } = useCatalog();
  const { data: allOrgPacks = [] } = useOrgPacks();
  const ourPacks = allOrgPacks.filter((p) => p.orgId === orgId && !p.archived);
  const [items, setItems] = useState<AssignmentView[]>([]);
  const [cohorts, setCohorts] = useState<CohortView[]>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [form, setForm] = useState({ title: "", packId: "", audience: coachCohortId ? `c:${coachCohortId}` : "", due: "", target: "1" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, c, g] = await Promise.all([
        orgApi<{ assignments: AssignmentView[] }>(`/api/orgs/${slug}/assignments`),
        orgApi<{ cohorts: CohortView[] }>(`/api/orgs/${slug}/cohorts`),
        // Groups are for people who manage cohorts; a coach just doesn't get any.
        coachCohortId ? Promise.resolve({ groups: [] as GroupView[] }) : orgApi<{ groups: GroupView[] }>(`/api/orgs/${slug}/groups`).catch(() => ({ groups: [] as GroupView[] })),
      ]);
      setItems(a.assignments);
      setCohorts(c.cohorts.filter((x) => !x.archived));
      setGroups(g.groups.filter((x) => !x.archived));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load assignments.");
    }
  }, [slug, coachCohortId]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const packTitle = (id: string) => catalog.packs.find((p) => p.id === id)?.title ?? allOrgPacks.find((p) => p.id === id)?.title ?? id;
  const audienceName = (a: AssignmentView) => (a.groupId ? `Group: ${groups.find((g) => g.id === a.groupId)?.name ?? "a group"}` : a.cohortId ? (cohorts.find((c) => c.id === a.cohortId)?.path ?? "a section") : "Everyone");
  const coachPath = coachCohortId ? cohorts.find((c) => c.id === coachCohortId)?.path : undefined;
  const choosable = coachCohortId ? cohorts.filter((c) => c.id === coachCohortId || (coachPath && c.path.startsWith(`${coachPath} / `))) : cohorts;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await orgApi(`/api/orgs/${slug}/assignments`, {
        method: "POST",
        body: {
          title: form.title.trim() || packTitle(form.packId),
          packId: form.packId,
          ...audience(form.audience),
          // End of the chosen day, local time.
          dueAt: form.due ? new Date(`${form.due}T23:59:59`).toISOString() : null,
          targetMockCount: Math.max(1, Number(form.target) || 1),
        },
      });
      setForm({ title: "", packId: "", audience: coachCohortId ? `c:${coachCohortId}` : "", due: "", target: "1" });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't set the assignment.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: AssignmentView) => {
    if (!(await confirm({ message: `Remove "${a.title}"? Mocks already done for it stay in members' history.`, danger: true }))) return;
    try {
      await orgApi(`/api/orgs/${slug}/assignments/${a.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't remove.");
    }
  };

  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="mb-3 text-sm font-semibold">New assignment</h2>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            Round
            <select className="input" required value={form.packId} onChange={(e) => setForm({ ...form, packId: e.target.value })}>
              <option value="" disabled>Choose a round</option>
              {ourPacks.length > 0 && (
                <optgroup label="Our rounds">
                  {ourPacks.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMin} min</option>)}
                </optgroup>
              )}
              <optgroup label="Built-in rounds">
                {catalog.packs.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMin} min</option>)}
              </optgroup>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            Title (optional)
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.packId ? packTitle(form.packId) : "Week 1: behavioural practice"} />
          </label>
          <label className="grid gap-1.5 text-sm">
            For
            <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {!coachCohortId && <option value="">Everyone</option>}
              {choosable.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.path}</option>)}
              {groups.length > 0 && (
                <optgroup label="Groups">
                  {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm">
              Due (optional)
              <input className="input" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm">
              Mocks each
              <input className="input" inputMode="numeric" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value.replace(/\D/g, "") })} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <button className="btn btn-primary" disabled={busy || !form.packId}><Plus size={15} /> {busy ? "Setting…" : "Set assignment"}</button>
          </div>
        </form>
      </Card>

      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}

      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Assignments ({items.length})</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-muted">
                    {[packTitle(a.packId), audienceName(a), a.targetMockCount > 1 ? `${a.targetMockCount} mocks each` : null, dueText(a.dueAt)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted">{a.completedBy} of {a.assignedTo} done</span>
                  <button className="text-muted hover:text-danger" aria-label={`Remove ${a.title}`} onClick={() => remove(a)}><Trash2 size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
