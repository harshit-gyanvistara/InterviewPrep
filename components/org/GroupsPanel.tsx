"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Card } from "@/components/Shell";
import type { GroupView, MemberView } from "@/lib/orgCohorts";
import { orgApi } from "./api";

// Groups: overlapping sets of members, like "Amazon drive shortlist", that work can be assigned to
// (plans/b2b-college.md B.2). A person can be in several. For people with cohorts.manage.

export function GroupsPanel({ slug, members }: { slug: string; members: MemberView[] }) {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups((await orgApi<{ groups: GroupView[] }>(`/api/orgs/${slug}/groups`)).groups);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load groups.");
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

  const students = members.filter((m) => m.role === "member");

  return (
    <Card className="grid gap-3">
      <h2 className="text-sm font-semibold">Groups</h2>
      <p className="text-sm text-muted">For sets that cut across sections, like a company drive shortlist. Pick who is in a group, then assign work to it.</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await orgApi(`/api/orgs/${slug}/groups`, { method: "POST", body: { name } });
            setName("");
          });
        }}
      >
        <input className="input max-w-xs" required placeholder="Amazon drive" value={name} onChange={(e) => setName(e.target.value)} aria-label="New group name" />
        <button className="btn btn-primary"><Plus size={15} /> Add group</button>
      </form>
      {groups.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {groups.map((g) => (
            <li key={g.id} className="border-b border-line py-2 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={g.archived ? "text-muted line-through" : ""}>{g.name}</span>
                <span className="flex items-center gap-3 text-muted">
                  {g.members} member{g.members === 1 ? "" : "s"}
                  <button className="hover:text-ink" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "Done" : "Edit members"}</button>
                  <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => run(() => orgApi(`/api/orgs/${slug}/groups/${g.id}`, { method: "PATCH", body: { archived: !g.archived } }))}>
                    {g.archived ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
                  </button>
                </span>
              </div>
              {open === g.id && (
                <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
                  {students.length === 0 && <li className="text-muted">No members to add yet.</li>}
                  {students.map((m) => {
                    const on = g.memberIds.includes(m.userId);
                    return (
                      <li key={m.userId}>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => run(() => orgApi(`/api/orgs/${slug}/groups/${g.id}`, { method: "PATCH", body: { memberIds: on ? g.memberIds.filter((id) => id !== m.userId) : [...g.memberIds, m.userId] } }))}
                          />
                          <span className="min-w-0 truncate">{m.email ?? m.userId}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </Card>
  );
}
