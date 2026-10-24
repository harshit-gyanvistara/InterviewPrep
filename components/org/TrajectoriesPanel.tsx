"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/Shell";
import { useConfirm } from "@/lib/dialogContext";
import { useCatalog, useOrgPacks } from "@/lib/db";
import type { CohortView, GroupView } from "@/lib/orgCohorts";
import { MAX_STAGES } from "@/lib/trajectory";
import type { TrajectoryView } from "@/lib/orgTrajectories";
import { orgApi } from "./api";

// Plans of stages (plans/b2b-college.md B.6): build one once, give it to a section or group. Each
// stage is a round to practise a number of times, optionally with a score to reach. People with
// assignments.create; a coach can only give plans to their own part of the tree (the server checks).

interface StageForm {
  title: string;
  packId: string;
  targetCount: string;
  dueDays: string;
  gateScore: string;
  mandatory: boolean;
}
interface Draft {
  id: string | null;
  name: string;
  description: string;
  stages: StageForm[];
}

const blankStage = (): StageForm => ({ title: "", packId: "", targetCount: "1", dueDays: "", gateScore: "", mandatory: true });
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));

export function TrajectoriesPanel({ slug, orgId, coachCohortId }: { slug: string; orgId: string; coachCohortId: string | null }) {
  const confirm = useConfirm();
  const { catalog } = useCatalog();
  const { data: allOrgPacks = [] } = useOrgPacks();
  const ourPacks = allOrgPacks.filter((p) => p.orgId === orgId && !p.archived);
  const [plans, setPlans] = useState<TrajectoryView[]>([]);
  const [cohorts, setCohorts] = useState<CohortView[]>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [giveTo, setGiveTo] = useState<Record<string, { audience: string; start: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c, g] = await Promise.all([
        orgApi<{ trajectories: TrajectoryView[] }>(`/api/orgs/${slug}/trajectories`),
        orgApi<{ cohorts: CohortView[] }>(`/api/orgs/${slug}/cohorts`),
        coachCohortId ? Promise.resolve({ groups: [] as GroupView[] }) : orgApi<{ groups: GroupView[] }>(`/api/orgs/${slug}/groups`).catch(() => ({ groups: [] as GroupView[] })),
      ]);
      setPlans(t.trajectories);
      setCohorts(c.cohorts.filter((x) => !x.archived));
      setGroups(g.groups.filter((x) => !x.archived));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load plans.");
    }
  }, [slug, coachCohortId]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const packTitle = (id: string) => catalog.packs.find((p) => p.id === id)?.title ?? allOrgPacks.find((p) => p.id === id)?.title ?? id;
  const coachPath = coachCohortId ? cohorts.find((c) => c.id === coachCohortId)?.path : undefined;
  const choosable = coachCohortId ? cohorts.filter((c) => c.id === coachCohortId || (coachPath && c.path.startsWith(`${coachPath} / `))) : cohorts;
  const audienceName = (cohortId: string | null, groupId: string | null) => (groupId ? `Group: ${groups.find((g) => g.id === groupId)?.name ?? "a group"}` : cohortId ? (cohorts.find((c) => c.id === cohortId)?.path ?? "a section") : "Everyone");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (p: TrajectoryView) =>
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description,
      stages: p.stages.map((s) => ({ title: s.title, packId: s.packId, targetCount: String(s.targetCount), dueDays: s.dueDays === null ? "" : String(s.dueDays), gateScore: s.gateScore === null ? "" : String(s.gateScore), mandatory: s.mandatory })),
    });

  const save = () =>
    run(async () => {
      if (!draft) return;
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        stages: draft.stages.map((s) => ({ title: s.title.trim() || packTitle(s.packId), packId: s.packId, targetCount: Math.max(1, num(s.targetCount) ?? 1), dueDays: num(s.dueDays), gateScore: num(s.gateScore), mandatory: s.mandatory })),
      };
      if (draft.id) await orgApi(`/api/orgs/${slug}/trajectories/${draft.id}`, { method: "PATCH", body });
      else await orgApi(`/api/orgs/${slug}/trajectories`, { method: "POST", body });
      setDraft(null);
    });

  const setStage = (i: number, patch: Partial<StageForm>) => setDraft((d) => (d ? { ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const moveStage = (i: number, by: number) =>
    setDraft((d) => {
      if (!d) return d;
      const to = i + by;
      if (to < 0 || to >= d.stages.length) return d;
      const stages = [...d.stages];
      [stages[i], stages[to]] = [stages[to], stages[i]];
      return { ...d, stages };
    });

  const give = (p: TrajectoryView) =>
    run(async () => {
      const g = giveTo[p.id] ?? { audience: coachCohortId ? `c:${coachCohortId}` : "", start: "" };
      await orgApi(`/api/orgs/${slug}/trajectories/${p.id}/assign`, {
        method: "POST",
        body: {
          cohortId: g.audience.startsWith("c:") ? g.audience.slice(2) : null,
          groupId: g.audience.startsWith("g:") ? g.audience.slice(2) : null,
          startsAt: g.start ? new Date(`${g.start}T00:00:00`).toISOString() : undefined,
        },
      });
      setMsg(`Given out. Its stages now appear under Assignments and on each member's dashboard.`);
    });

  const roundOptions = (
    <>
      {ourPacks.length > 0 && (
        <optgroup label="Our rounds">
          {ourPacks.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMin} min</option>)}
        </optgroup>
      )}
      <optgroup label="Built-in rounds">
        {catalog.packs.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMin} min</option>)}
      </optgroup>
    </>
  );

  return (
    <div className="grid gap-5">
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Plans</h2>
          <button className="btn btn-primary" onClick={() => setDraft({ id: null, name: "", description: "", stages: [blankStage()] })}><Plus size={15} /> New plan</button>
        </div>
        <p className="text-sm text-muted">A plan is a sequence of stages, like behavioural, then technical, then a company mock. Give it to a section or group and each member sees their stage, what to do next, and how they are doing. A score to reach means a mock only counts if it gets there. Changing a plan later doesn&apos;t change what was already given out.</p>
        {plans.length === 0 && <p className="text-sm text-muted">No plans yet.</p>}
        {plans.map((p) => {
          const g = giveTo[p.id] ?? { audience: coachCohortId ? `c:${coachCohortId}` : "", start: "" };
          return (
            <div key={p.id} className="grid gap-3 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b className={p.archived ? "text-muted line-through" : ""}>{p.name}</b>
                  <span className="ml-2 text-sm text-muted">{p.stages.length} stage{p.stages.length === 1 ? "" : "s"}</span>
                </div>
                <span className="flex items-center gap-3 text-sm text-muted">
                  <button className="hover:text-ink" onClick={() => edit(p)}>Edit</button>
                  <button className="hover:text-ink" onClick={() => run(() => orgApi(`/api/orgs/${slug}/trajectories/${p.id}`, { method: "PATCH", body: { archived: !p.archived } }))}>{p.archived ? "Restore" : "Archive"}</button>
                </span>
              </div>
              <ol className="grid gap-1 text-sm">
                {p.stages.map((s) => (
                  <li key={s.id} className="text-muted">
                    <span className="text-ink">{s.position}. {s.title}</span> · {packTitle(s.packId)} · {s.targetCount} mock{s.targetCount === 1 ? "" : "s"}
                    {s.gateScore !== null ? ` · score ${s.gateScore}+` : ""}{s.dueDays !== null ? ` · due day ${s.dueDays}` : ""}{s.mandatory ? "" : " · optional"}
                  </li>
                ))}
              </ol>
              {!p.archived && (
                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <label className="grid gap-1 text-xs text-muted">
                    Give to
                    <select className="input w-auto" value={g.audience} onChange={(e) => setGiveTo({ ...giveTo, [p.id]: { ...g, audience: e.target.value } })}>
                      {!coachCohortId && <option value="">Everyone</option>}
                      {choosable.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.path}</option>)}
                      {groups.length > 0 && <optgroup label="Groups">{groups.map((x) => <option key={x.id} value={`g:${x.id}`}>{x.name}</option>)}</optgroup>}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-muted">
                    Starts (optional)
                    <input className="input" type="date" value={g.start} onChange={(e) => setGiveTo({ ...giveTo, [p.id]: { ...g, start: e.target.value } })} />
                  </label>
                  <button className="btn btn-primary" disabled={busy} onClick={() => give(p)}>Give out</button>
                </div>
              )}
              {p.runs.length > 0 && (
                <ul className="grid gap-1 text-xs text-muted">
                  {p.runs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>Given to {audienceName(r.cohortId, r.groupId)} · from {new Date(r.startsAt).toLocaleDateString()}</span>
                      <button
                        className="text-danger hover:underline"
                        onClick={async () => {
                          if (!(await confirm({ message: `Take "${p.name}" back from ${audienceName(r.cohortId, r.groupId)}? Its stages are removed from their lists. Mocks already taken stay in members' history.`, danger: true }))) return;
                          await run(() => orgApi(`/api/orgs/${slug}/trajectory-runs/${r.id}`, { method: "DELETE" }));
                        }}
                      >
                        Take back
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </Card>

      {draft && (
        <Card className="grid gap-3">
          <h2 className="text-sm font-semibold">{draft.id ? "Edit plan" : "New plan"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">Name<input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Campus placement, 8 weeks" /></label>
            <label className="grid gap-1.5 text-sm">Description (optional)<input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          </div>
          <div className="grid gap-3">
            {draft.stages.map((s, i) => (
              <div key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-6">
                <label className="grid gap-1 text-xs text-muted sm:col-span-2">Stage {i + 1} name<input className="input" value={s.title} onChange={(e) => setStage(i, { title: e.target.value })} placeholder={s.packId ? packTitle(s.packId) : "Behavioural warm-up"} /></label>
                <label className="grid gap-1 text-xs text-muted sm:col-span-2">
                  Round
                  <select className="input" value={s.packId} onChange={(e) => setStage(i, { packId: e.target.value })}>
                    <option value="" disabled>Choose a round</option>
                    {roundOptions}
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-muted">Mocks<input className="input" inputMode="numeric" value={s.targetCount} onChange={(e) => setStage(i, { targetCount: e.target.value.replace(/\D/g, "") })} /></label>
                <label className="grid gap-1 text-xs text-muted">Due after (days)<input className="input" inputMode="numeric" value={s.dueDays} onChange={(e) => setStage(i, { dueDays: e.target.value.replace(/\D/g, "") })} placeholder="none" /></label>
                <label className="grid gap-1 text-xs text-muted">Score to reach<input className="input" inputMode="numeric" value={s.gateScore} onChange={(e) => setStage(i, { gateScore: e.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="any" /></label>
                <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={s.mandatory} onChange={(e) => setStage(i, { mandatory: e.target.checked })} /> Required</label>
                <div className="flex items-end justify-end gap-1 sm:col-span-3">
                  <button className="btn btn-ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveStage(i, -1)}><ArrowUp size={14} /></button>
                  <button className="btn btn-ghost" aria-label="Move down" disabled={i === draft.stages.length - 1} onClick={() => moveStage(i, 1)}><ArrowDown size={14} /></button>
                  <button className="btn btn-ghost" aria-label="Remove stage" disabled={draft.stages.length === 1} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" disabled={draft.stages.length >= MAX_STAGES} onClick={() => setDraft({ ...draft, stages: [...draft.stages, blankStage()] })}><Plus size={15} /> Add stage</button>
            <button className="btn btn-primary" disabled={busy || !draft.name.trim() || draft.stages.some((s) => !s.packId)} onClick={save}>{busy ? "Saving…" : "Save plan"}</button>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </Card>
      )}
      {msg && <p className="rounded-lg bg-card px-3 py-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}
