"use client";

import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { useState } from "react";
import { LineChart, Trash2 } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { db, useAllPacks, useReports } from "@/lib/db";
import { isScored, scoreTone, verdictTone, type Tone } from "@/lib/analysis";
import { ScoreBadge, TonePill } from "@/components/ScoreBadge";
import { useConfirm } from "@/lib/dialogContext";
import { dateTime } from "@/lib/format";

const BAR: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" };

export default function Progress() {
  const { data: reports = [], loading } = useReports();
  const { byId } = useAllPacks();
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  if (loading) return <PageSkeleton />;

  const remove = async (sessionId: string, reportId: string) => {
    if (!(await confirm({ message: "Delete this session and its report?", danger: true }))) return;
    await db.reports.remove(reportId);
    await db.sessions.remove(sessionId);
  };
  const shown = filter === "all" ? reports : reports.filter((r) => r.packId === filter);

  const chrono = reports.filter(isScored).reverse();
  const W = 640;
  const H = 180;
  const pts = chrono.map((r, i) => ({
    x: chrono.length === 1 ? W / 2 : 30 + (i * (W - 60)) / (chrono.length - 1),
    y: H - 20 - (r.overall / 100) * (H - 40),
    r,
  }));

  // average per rubric dimension across all mocks
  const dims = new Map<string, number[]>();
  reports.forEach((r) => r.dimensions.forEach((d) => d.assessed !== false && dims.set(d.name, [...(dims.get(d.name) ?? []), d.score])));
  const dimAvg = [...dims.entries()]
    .map(([name, v]) => ({ name, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.avg - b.avg);

  return (
    <div>
      <PageTitle title="Your progress" sub="Scores over time and where you are weakest." />
      {reports.length === 0 ? (
        <EmptyState
          icon={<LineChart size={20} />}
          title="Your trend starts with one mock"
          text="Finish a mock interview and your scores, weakest skills and history show up here."
          action={{ label: "Start a mock", href: "/practice" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-medium">Overall score</h2>
            <div className="relative h-48 pl-8">
              {[0, 50, 100].map((g) => (
                <span key={g} className="absolute left-0 -translate-y-1/2 text-[11px] leading-none text-muted" style={{ top: `${((H - 20 - (g / 100) * (H - 40)) / H) * 100}%` }}>{g}</span>
              ))}
              <div className="relative h-full">
                {/* Stretches to the box (non-scaling strokes stay crisp); dots and labels are HTML
                    placed by percentage, so they stay readable and tappable at a phone's width. */}
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                  {[0, 50, 100].map((g) => {
                    const y = H - 20 - (g / 100) * (H - 40);
                    return <line key={g} x1="0" x2={W} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />;
                  })}
                  {pts.length > 1 && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                </svg>
                {pts.map((p) => (
                  <Link
                    key={p.r.id}
                    href={`/report/${p.r.sessionId}`}
                    aria-label={`${byId(p.r.packId)?.title ?? "Interview"}, ${p.r.overall} out of 100, ${dateTime(p.r.createdAt)}`}
                    className="group absolute grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center"
                    style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
                  >
                    <span className="absolute bottom-full text-xs font-semibold tabular-nums">{p.r.overall}</span>
                    <span className="h-3 w-3 rounded-full bg-accent ring-2 ring-card transition group-hover:scale-125" />
                  </Link>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-medium">Weakest areas</h2>
            <div className="grid gap-3">
              {dimAvg.slice(0, 6).map((d) => (
                <div key={d.name}>
                  <div className="mb-1 flex justify-between text-xs"><span>{d.name}</span><span>{d.avg.toFixed(1)}/10</span></div>
                  <div className="h-2 rounded-full bg-soft"><div className={`h-full rounded-full ${BAR[scoreTone(d.avg * 10)]}`} style={{ width: `${d.avg * 10}%` }} /></div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-medium">History</h2>
              <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All rounds</option>
                {[...new Set(reports.map((r) => r.packId))].map((id) => (<option key={id} value={id}>{byId(id)?.title ?? id}</option>))}
              </select>
            </div>
            <ul className="grid grid-cols-1 gap-2">
              {shown.length === 0 && <li className="rounded-2xl bg-soft p-4 text-sm text-muted">No sessions for this round.</li>}
              {shown.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Link href={`/report/${r.sessionId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line px-3 py-2.5 transition hover:bg-soft">
                    <ScoreBadge score={isScored(r) ? r.overall : null} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{byId(r.packId)?.title ?? r.packId}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="whitespace-nowrap">{dateTime(r.createdAt)}</span>
                        {/* On phones the verdict sits under the title, leaving the title room. */}
                        <span className="sm:hidden"><TonePill tone={verdictTone(r.verdict)}>{r.verdict}</TonePill></span>
                      </div>
                    </div>
                    <span className="hidden sm:block"><TonePill tone={verdictTone(r.verdict)}>{r.verdict}</TonePill></span>
                  </Link>
                  <button onClick={() => remove(r.sessionId, r.id)} aria-label="Delete session" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-soft hover:text-danger"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
