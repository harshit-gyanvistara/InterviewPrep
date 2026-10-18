"use client";

import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { ArrowRight, Mic, StickyNote } from "lucide-react";
import { Card } from "@/components/Shell";
import { MocksLeft } from "@/components/MocksLeft";
import { NoteCard } from "@/components/notes/NoteCard";
import { useAllPacks, useNoteList, useProfile, useReports, useSessions } from "@/lib/db";
import { visibleBuiltInPacks } from "@/lib/packs";
import { isScored, scoreTone, verdictTone } from "@/lib/analysis";
import { ScoreBadge, TonePill } from "@/components/ScoreBadge";
import { useNotesPanel } from "@/lib/notesContext";
import { daysUntil, recommendPack, sessionsThisWeek, streakDays, weakestDimension } from "@/lib/recommend";

export default function Dashboard() {
  const { data: profile, loading } = useProfile();
  const { data: reports = [] } = useReports();
  const { data: sessions = [] } = useSessions();
  const { custom: customPacks, catalog, byId, loading: packsLoading } = useAllPacks();
  const { data: notes = [] } = useNoteList();
  const { openPanel } = useNotesPanel();

  if (loading || packsLoading || !profile) return <PageSkeleton />;

  const packs = [...customPacks, ...visibleBuiltInPacks(profile, catalog)];
  const done = sessions.filter((s) => s.status === "done");
  const inProgress = sessions.find((s) => s.status === "active" && s.messages.length > 0);
  const lobby = sessions.find((s) => s.status === "lobby");
  const rec = recommendPack(reports, packs);
  const last3 = reports.filter(isScored).slice(0, 3);
  const readiness = last3.length ? Math.round(last3.reduce((s, r) => s + r.overall, 0) / last3.length) : null;
  const weekCount = sessionsThisWeek(sessions);
  const goal = profile.weeklyGoal || 3;
  const streak = streakDays(done.map((s) => s.startedAt));
  const days = daysUntil(profile.interviewDate);
  const weak = weakestDimension(reports);
  const covered = new Set(reports.map((r) => r.packId)).size;

  const action = inProgress
    ? { title: "Resume your interview", text: `${byId(inProgress.config.packId)?.title} is still open. Pick up where you left off.`, href: `/interview/${inProgress.id}`, cta: "Resume" }
    : lobby
      ? { title: "You have an interview waiting", text: `${byId(lobby.config.packId)?.title} is set up. Join when you're ready.`, href: `/interview/${lobby.id}`, cta: "Open lobby" }
      : reports.length === 0
        ? { title: "Take your baseline mock", text: "15 minutes. It shows where you stand and personalises your plan.", href: `/practice?pack=${rec.pack.id}`, cta: "Start baseline" }
        : { title: rec.pack.title, text: rec.reason, href: `/practice?pack=${rec.pack.id}`, cta: "Start practice" };
  const suggesting = !inProgress && !lobby;

  const firstName = profile.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // The latest report's three weakest skills, lowest first.
  const focus = [...(reports[0]?.dimensions ?? [])].sort((a, b) => a.score - b.score).slice(0, 3);
  const interviewNote = days !== null && days >= 0 ? (days === 0 ? "interview today" : `interview in ${days} day${days === 1 ? "" : "s"}`) : null;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[30px] sm:leading-9">{greeting}, {firstName}</h1>
          <p className="mt-1 text-muted">
            {[profile.targetRole, profile.targetCompanies, interviewNote].filter(Boolean).join(" · ")}
          </p>
        </div>
        <MocksLeft className="rounded-full bg-accent-soft px-3 py-1 font-medium !text-accent" />
      </div>

      {!profile.jobDescription?.trim() && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm">
          <span className="text-muted">Add the job description you&apos;re preparing for and we&apos;ll build rounds around exactly what it asks.</span>
          <Link href="/settings" className="btn btn-ghost !py-1.5">Add job description</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="grid content-start gap-4 rounded-xl bg-card p-6 shadow-float sm:p-7">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Your next step</span>
            {suggesting && <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs font-medium capitalize text-muted">{rec.pack.durationMin} min · {rec.pack.roundType}</span>}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{action.title}</h2>
          <p className="max-w-[52ch] text-muted">{action.text}</p>
          <div className="flex flex-wrap gap-2.5">
            <Link href={action.href} className="btn btn-primary">{action.cta} <ArrowRight size={16} /></Link>
            {suggesting && <Link href="/practice" className="btn btn-ghost">Choose another round</Link>}
          </div>
        </section>

        <Card className="grid content-start gap-5">
          <div className="grid gap-2.5">
            <div className="flex items-baseline justify-between text-sm">
              <h3 className="font-semibold">This week</h3>
              <span className="tabular-nums text-muted">{Math.min(weekCount, goal)} / {goal} mocks</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-soft">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (weekCount / goal) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted">{weekCount >= goal ? "Weekly goal reached. Nice work." : `${goal - weekCount} more to hit your weekly goal.`}</p>
          </div>
          <div className="h-px bg-line" />
          <div className="grid gap-2.5">
            <h3 className="text-sm font-semibold">Focus areas</h3>
            {focus.length ? (
              focus.map((d) => (
                <div key={d.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{d.name}</span>
                  <TonePill tone={scoreTone(d.score * 10)}>{d.score.toFixed(1)}</TonePill>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Your weakest skills show here after your first mock.</p>
            )}
          </div>
        </Card>
      </div>

      <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-card sm:grid-cols-4">
        <Stat value={readiness ?? "–"} label="Readiness (last 3)" />
        <Stat value={`${covered} / ${packs.length}`} label="Rounds tried" />
        <Stat value={streak} label="Day streak" />
        <Stat value={weak ?? "–"} label="Weakest area" small />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-semibold">Recent reports</h2>
            <Link href="/progress" className="text-sm font-medium text-accent">View all</Link>
          </div>
          {reports.length === 0 ? (
            <EmptyState
              className="m-5"
              icon={<Mic size={20} />}
              title="No reports yet"
              text="Take a 15-minute baseline mock. Your score, focus areas and top fixes appear here."
              action={{ label: "Start baseline", href: action.href }}
            />
          ) : (
            <ul>
              {reports.slice(0, 5).map((r) => (
                <li key={r.id} className="border-t border-line first:border-t-0">
                  <Link href={`/report/${r.sessionId}`} className="flex items-center gap-3.5 px-5 py-3 transition hover:bg-soft">
                    <ScoreBadge score={isScored(r) ? r.overall : null} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{byId(r.packId)?.title ?? r.packId}</div>
                      <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
                    </div>
                    <TonePill tone={verdictTone(r.verdict)}>{r.verdict}</TonePill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Fix these first</h2>
          {reports[0] ? (
            <ol className="grid gap-3 text-sm">
              {reports[0].topFixes.map((f, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-semibold tabular-nums text-accent">{i + 1}</span>
                  <span>{f}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Your top fixes appear here after your first report.</p>
          )}
          <Link href="/prepare" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">Open your prep plan <ArrowRight size={14} /></Link>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><StickyNote size={16} /> Notes</h2>
          <div className="flex items-center gap-4">
            <button onClick={() => openPanel()} className="text-sm font-medium text-accent">New note</button>
            <Link href="/notes" className="text-sm text-muted hover:text-ink">View all</Link>
          </div>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Press &quot;n&quot; anywhere to jot something down and attach it to an interview, round or plan item.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.slice(0, 3).map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** One cell of the stats row. Dividers: between cells on a row, and above the second row on phones. */
function Stat({ value, label, small }: { value: React.ReactNode; label: string; small?: boolean }) {
  return (
    <div className="grid content-start gap-0.5 border-line px-5 py-4 [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+2)]:border-l sm:[&:nth-child(n+3)]:border-t-0">
      <div className={`font-semibold tracking-tight tabular-nums ${small ? "truncate text-base leading-[34px]" : "text-[28px] leading-[34px]"}`}>{value}</div>
      <div className="text-[13px] text-muted">{label}</div>
    </div>
  );
}
