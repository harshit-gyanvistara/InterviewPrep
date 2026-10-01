"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { NoteChip } from "@/components/NoteChip";
import { StoryBank } from "@/components/StoryBank";
import { db, uid, useAllPacks, useProfile, useQuery, useReports } from "@/lib/db";
import type { Roadmap } from "@/lib/types";

export default function PreparePage() {
  return (
    <Suspense>
      <Prepare />
    </Suspense>
  );
}

function Prepare() {
  const tabParam = useSearchParams().get("tab");
  const [tab, setTab] = useState<"roadmap" | "stories">(tabParam === "stories" ? "stories" : "roadmap");
  return (
    <div>
      <PageTitle title="Prepare" sub="Your plan and your story bank." />
      <div className="mb-5 inline-flex rounded-full bg-card p-1 text-sm">
        {(["roadmap", "stories"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 ${tab === t ? "bg-accent text-accent-ink" : "text-muted"}`}>{t === "roadmap" ? "Roadmap" : "Story bank"}</button>
        ))}
      </div>
      {tab === "roadmap" ? <RoadmapTab /> : <StoryBank />}
    </div>
  );
}

function RoadmapTab() {
  const { data: profile } = useProfile();
  const { data: reports = [] } = useReports();
  const { byId } = useAllPacks();
  const { data: roadmap } = useQuery(async () => (await db.roadmaps.list()).sort((a, b) => b.createdAt - a.createdAt)[0], []);
  const [weeks, setWeeks] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const digests = reports.slice(0, 10).map((r) => ({
        pack: byId(r.packId)?.title,
        overall: r.overall,
        weakDimensions: [...r.dimensions].sort((a, b) => a.score - b.score).slice(0, 2).map((d) => d.name),
        topFixes: r.topFixes,
      }));
      const res = await fetch("/api/roadmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile, weeks, digests }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      const rm: Roadmap = {
        id: uid(),
        createdAt: Date.now(),
        summary: json.summary,
        items: json.items.map((i: { week: number; title: string; detail: string; focus: string }) => ({ ...i, id: uid(), done: false })),
      };
      await db.roadmaps.put(rm);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate roadmap");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (itemId: string) => {
    if (!roadmap) return;
    await db.roadmaps.put({ ...roadmap, items: roadmap.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) });
  };

  if (!profile)
    return (
      <Card>
        <p className="text-sm">Set up your profile first.</p>
        <Link href="/" className="btn btn-primary mt-4">Go to setup</Link>
      </Card>
    );

  const byWeek = new Map<number, Roadmap["items"]>();
  roadmap?.items.forEach((i) => byWeek.set(i.week, [...(byWeek.get(i.week) ?? []), i]));
  const done = roadmap ? roadmap.items.filter((i) => i.done).length : 0;

  return (
    <div>
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-3 text-sm">
            Weeks
            <select className="input !w-24" value={weeks} onChange={(e) => setWeeks(+e.target.value)}>
              {[2, 4, 6, 8, 12].map((w) => (<option key={w}>{w}</option>))}
            </select>
          </label>
          <button onClick={generate} disabled={busy} className="btn btn-primary">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {roadmap ? "Regenerate" : "Generate roadmap"}
          </button>
          <span className="text-xs text-muted">
            {reports.length ? `Uses your last ${Math.min(reports.length, 10)} mock results.` : "No mocks yet — the plan will start with a baseline mock."}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      {roadmap && (
        <>
          <Card className="mb-5">
            <p className="text-sm text-muted">{roadmap.summary}</p>
            <div className="mt-3 h-2 rounded-full bg-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${(done / Math.max(1, roadmap.items.length)) * 100}%` }} /></div>
            <p className="mt-1 text-xs text-muted">{done}/{roadmap.items.length} completed</p>
          </Card>
          <div className="grid gap-5 md:grid-cols-2">
            {[...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([w, items]) => (
              <Card key={w}>
                <h3 className="mb-3 text-lg font-medium">Week {w}</h3>
                <ul className="grid gap-2">
                  {items.map((i) => (
                    <li key={i.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-soft p-3 text-sm">
                        <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} className="mt-1" />
                        <span className={`flex-1 ${i.done ? "opacity-50 line-through" : ""}`}>
                          <span className="font-medium">{i.title}</span>
                          <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-[10px] text-muted">{i.focus}</span>
                          <span className="mt-1 block text-muted">{i.detail}</span>
                        </span>
                        <NoteChip link={{ type: "roadmap-item", id: i.id, label: i.title }} />

                      </label>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
