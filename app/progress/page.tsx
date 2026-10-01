"use client";

import Link from "next/link";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { db, useAllPacks, useReports } from "@/lib/db";
import { verdictColor } from "@/lib/analysis";
import { useConfirm } from "@/lib/dialogContext";

export default function Progress() {
  const { data: reports = [], loading } = useReports();
  const { byId } = useAllPacks();
  const confirm = useConfirm();
  const [filter, setFilter] = useState("all");
  if (loading) return null;

  const remove = async (sessionId: string, reportId: string) => {
    if (!(await confirm({ message: "Delete this session and its report?", danger: true }))) return;
    await db.reports.remove(reportId);
    await db.sessions.remove(sessionId);
  };
  const shown = filter === "all" ? reports : reports.filter((r) => r.packId === filter);

  const chrono = [...reports].reverse();
  const W = 640;
  const H = 180;
  const pts = chrono.map((r, i) => ({
    x: chrono.length === 1 ? W / 2 : 30 + (i * (W - 60)) / (chrono.length - 1),
    y: H - 20 - (r.overall / 100) * (H - 40),
    r,
  }));

  // average per rubric dimension across all mocks
  const dims = new Map<string, number[]>();
  reports.forEach((r) => r.dimensions.forEach((d) => dims.set(d.name, [...(dims.get(d.name) ?? []), d.score])));
  const dimAvg = [...dims.entries()]
    .map(([name, v]) => ({ name, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.avg - b.avg);

  return (
    <div>
      <PageTitle title="Your progress" sub="Scores over time and where you are weakest." />
      {reports.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Complete a mock interview to see your trend.</p>
          <Link href="/practice" className="btn btn-primary mt-4">Start practice</Link>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-medium">Overall score</h2>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
              {[0, 50, 100].map((g) => {
                const y = H - 20 - (g / 100) * (H - 40);
                return (
                  <g key={g}>
                    <line x1="30" x2={W - 10} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.12" />
                    <text x="0" y={y + 4} fontSize="10" fill="currentColor" opacity="0.5">{g}</text>
                  </g>
                );
              })}
              {pts.length > 1 && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />}
              {pts.map((p) => (
                <Link key={p.r.id} href={`/report/${p.r.sessionId}`}>
                  <circle cx={p.x} cy={p.y} r="6" fill="currentColor" />
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="11" fill="currentColor">{p.r.overall}</text>
                </Link>
              ))}
            </svg>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-medium">Weakest areas</h2>
            <div className="grid gap-3">
              {dimAvg.slice(0, 6).map((d) => (
                <div key={d.name}>
                  <div className="mb-1 flex justify-between text-xs"><span>{d.name}</span><span>{d.avg.toFixed(1)}/10</span></div>
                  <div className="h-2 rounded-full bg-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${d.avg * 10}%` }} /></div>
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
            <ul className="grid gap-2">
              {shown.length === 0 && <li className="rounded-2xl bg-soft p-4 text-sm text-muted">No sessions for this round.</li>}
              {shown.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Link href={`/report/${r.sessionId}`} className="flex flex-1 items-center justify-between rounded-2xl bg-soft px-4 py-3 hover:opacity-80">
                    <div>
                      <div className="text-sm font-medium">{byId(r.packId)?.title ?? r.packId}</div>
                      <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">{r.overall}</div>
                      <div className={`text-xs ${verdictColor(r.verdict)}`}>{r.verdict}</div>
                    </div>
                  </Link>
                  <button onClick={() => remove(r.sessionId, r.id)} aria-label="Delete session" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-soft hover:text-danger"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
