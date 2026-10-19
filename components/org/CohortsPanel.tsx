"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Card } from "@/components/Shell";
import type { CohortView, MemberView } from "@/lib/orgCohorts";
import { orgApi, roleLabel } from "./api";

// Cohorts and who's in them (plans/m2-org.md O.5). For people with cohorts.manage.

export function CohortsPanel({ slug }: { slug: string }) {
  const [cohorts, setCohorts] = useState<CohortView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [name, setName] = useState("");
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
        <h2 className="text-sm font-semibold">Cohorts</h2>
        <p className="text-sm text-muted">Groups like &quot;CSE 2027&quot; or &quot;Sales Q3&quot;. Assignments can go to one cohort, and a coach placed in a cohort sets work for that cohort.</p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await orgApi(`/api/orgs/${slug}/cohorts`, { method: "POST", body: { name } });
              setName("");
            });
          }}
        >
          <input className="input max-w-xs" required placeholder="CSE 2027" value={name} onChange={(e) => setName(e.target.value)} aria-label="New cohort name" />
          <button className="btn btn-primary"><Plus size={15} /> Add cohort</button>
        </form>
        {cohorts.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {cohorts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className={c.archived ? "text-muted line-through" : ""}>{c.name}</span>
                <span className="flex items-center gap-3 text-muted">
                  {c.members} member{c.members === 1 ? "" : "s"}
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
                  <option value="">No cohort</option>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {m.cohortId && !active.some((c) => c.id === m.cohortId) && <option value={m.cohortId}>(archived cohort)</option>}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </div>
  );
}
