"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Card } from "@/components/Shell";
import type { CohortView, MemberView } from "@/lib/orgCohorts";
import { GroupsPanel } from "./GroupsPanel";
import { orgApi, roleLabel } from "./api";

// Sections (cohorts as a tree), groups, and who's in them (plans/m2-org.md O.5, plans/b2b-college.md B.2).
// For people with cohorts.manage.

export function CohortsPanel({ slug }: { slug: string }) {
  const [cohorts, setCohorts] = useState<CohortView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        orgApi<{ cohorts: CohortView[] }>(`/api/orgs/${slug}/cohorts`),
        orgApi<{ members: MemberView[] }>(`/api/orgs/${slug}/members`),
      ]);
      setCohorts(c.cohorts);
      setMembers(m.members);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load cohorts.");
    }
  }, [slug]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    }
  };

  const active = cohorts.filter((c) => !c.archived);

  return (
    <div className="grid gap-5">
      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Sections</h2>
        <p className="text-sm text-muted">Arrange cohorts like a college: a department, its years, and their sections (for example CSE, then 2027, then A), up to 3 levels. Work set for a department covers every section under it, and a coach placed in one sees only that part.</p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await orgApi(`/api/orgs/${slug}/cohorts`, { method: "POST", body: { name, parentId: parentId || null } });
              setName("");
            });
          }}
        >
          <input className="input max-w-xs" required placeholder="CSE" value={name} onChange={(e) => setName(e.target.value)} aria-label="New section name" />
          <select className="input w-auto" value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Inside">
            <option value="">Top level</option>
            {active.map((c) => <option key={c.id} value={c.id}>Inside {c.path}</option>)}
          </select>
          <button className="btn btn-primary"><Plus size={15} /> Add section</button>
        </form>
        {cohorts.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {cohorts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0" style={{ paddingLeft: `${(c.path.split(" / ").length - 1) * 20}px` }}>
                <span className={c.archived ? "text-muted line-through" : ""}>{c.name}</span>
                <span className="flex flex-wrap items-center gap-3 text-muted">
                  {c.membersTotal} member{c.membersTotal === 1 ? "" : "s"}{c.membersTotal !== c.members ? ` (${c.members} directly)` : ""}
                  <select
                    className="input w-auto !py-0.5 text-xs"
                    aria-label={`Move ${c.name}`}
                    value={c.parentId ?? ""}
                    onChange={(e) => run(() => orgApi(`/api/orgs/${slug}/cohorts/${c.id}`, { method: "PATCH", body: { parentId: e.target.value || null } }))}
                  >
                    <option value="">Top level</option>
                    {active.filter((o) => o.id !== c.id).map((o) => <option key={o.id} value={o.id}>Inside {o.path}</option>)}
                  </select>
                  <button
                    className="inline-flex items-center gap-1 hover:text-ink"
                    onClick={() => run(() => orgApi(`/api/orgs/${slug}/cohorts/${c.id}`, { method: "PATCH", body: { archived: !c.archived } }))}
                  >
                    {c.archived ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Members ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">No members yet. Invite people from the Invites tab.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className="min-w-0 truncate">{m.email ?? m.userId} <span className="text-muted">· {roleLabel(m.role)}</span></span>
                <select
                  className="input w-auto !py-1"
                  aria-label={`Cohort for ${m.email ?? "member"}`}
                  value={m.cohortId ?? ""}
                  onChange={(e) => run(() => orgApi(`/api/orgs/${slug}/members/${m.userId}`, { method: "PATCH", body: { cohortId: e.target.value || null } }))}
                >
                  <option value="">No section</option>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
                  {m.cohortId && !active.some((c) => c.id === m.cohortId) && <option value={m.cohortId}>(archived cohort)</option>}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <GroupsPanel slug={slug} members={members} />
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </div>
  );
}
