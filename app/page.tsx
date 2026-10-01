"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, Flame, Lightbulb, StickyNote, Target, Trophy } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { NoteCard } from "@/components/notes/NoteCard";
import { useAllPacks, useNoteList, useProfile, useReports, useSessions } from "@/lib/db";
import { visibleBuiltInPacks } from "@/lib/packs";
import { verdictColor } from "@/lib/analysis";
import { useNotesPanel } from "@/lib/notesContext";
import { daysUntil, recommendPack, sessionsThisWeek, streakDays, weakestDimension } from "@/lib/recommend";

export default function Dashboard() {
  const { data: profile, loading } = useProfile();
  const { data: reports = [] } = useReports();
  const { data: sessions = [] } = useSessions();
  const { custom: customPacks, byId, loading: packsLoading } = useAllPacks();
  const { data: notes = [] } = useNoteList();
  const { openPanel } = useNotesPanel();

  if (loading || packsLoading || !profile) return null;

  const packs = [...customPacks, ...visibleBuiltInPacks(profile)];
  const done = sessions.filter((s) => s.status === "done");
  const inProgress = sessions.find((s) => s.status === "active" && s.messages.length > 0);
  const lobby = sessions.find((s) => s.status === "lobby");
  const rec = recommendPack(reports, packs);
  const last3 = reports.slice(0, 3);
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
        : { title: `Next up: ${rec.pack.title}`, text: rec.reason, href: `/practice?pack=${rec.pack.id}`, cta: "Practice now" };

  return (
    <div>
      <PageTitle title={`Let's talk, ${profile.name.split(" ")[0]}`} sub={`Target: ${profile.targetRole}${profile.targetCompanies ? ` · ${profile.targetCompanies}` : ""}`} />

      {days !== null && days >= 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl bg-hl px-5 py-3 text-sm">
          <CalendarClock size={18} />
          <span><b>{days === 0 ? "Your interview is today." : `${days} day${days === 1 ? "" : "s"} to your interview.`}</b> {days <= 14 ? "Focus on full mock rounds now." : "Plenty of time to build a routine."}</span>
        </div>
      )}

      {!profile.jobDescription?.trim() && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-hl px-5 py-3 text-sm">
          <span>Add the job description you&apos;re preparing for and we&apos;ll build interview rounds around exactly what it asks — for any profession.</span>
          <Link href="/settings" className="btn btn-primary !py-1.5">Add job description</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Your next step</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-medium">{action.title}</h2>
              <p className="mt-1 max-w-lg text-sm text-muted">{action.text}</p>
            </div>
            <Link href={action.href} className="btn btn-primary">{action.cta} <ArrowRight size={16} /></Link>
          </div>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">This week</span>
            <span className="text-muted">{Math.min(weekCount, goal)} / {goal} mocks</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (weekCount / goal) * 100)}%` }} /></div>
          <p className="mt-2 text-xs text-muted">{weekCount >= goal ? "Weekly goal reached. Nice work." : `${goal - weekCount} more to hit your goal.`}</p>
        </Card>

        <Card className="lg:col-span-3">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <Stat icon={<Trophy size={18} />} value={readiness ?? "–"} label="Readiness (last 3)" />
            <Stat icon={<Target size={18} />} value={`${covered}/${packs.length}`} label="Rounds tried" />
            <Stat icon={<Flame size={18} />} value={streak} label="Day streak" />
            <Stat icon={<Lightbulb size={18} />} value={weak ?? "–"} label="Weakest area" small />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Recent sessions</h2>
            <Link href="/progress" className="text-sm text-muted hover:text-ink">View all</Link>
          </div>
          {reports.length === 0 ? (
            <p className="rounded-2xl bg-soft p-6 text-center text-sm text-muted">No completed mocks yet.</p>
          ) : (
            <ul className="grid gap-2">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link href={`/report/${r.sessionId}`} className="flex items-center justify-between rounded-2xl bg-soft px-4 py-3 hover:opacity-80">
                    <div>
                      <div className="text-sm font-medium">{byId(r.packId)?.title ?? r.packId}</div>
                      <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-semibold">{r.overall}</div>
                      <div className={`text-xs ${verdictColor(r.verdict)}`}>{r.verdict}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-medium">Fix these first</h2>
          {reports[0] ? (
            <ol className="grid gap-2 text-sm">
              {reports[0].topFixes.map((f, i) => (
                <li key={i} className="rounded-2xl bg-soft p-3"><span className="mr-2 font-semibold">{i + 1}.</span>{f}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Your top fixes appear here after your first report.</p>
          )}
          <Link href="/prepare" className="mt-4 inline-block text-sm text-muted hover:text-ink">Open your prep plan →</Link>
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-medium"><StickyNote size={18} /> Notes</h2>
            <div className="flex items-center gap-3">
              <button onClick={() => openPanel()} className="text-sm text-muted hover:text-ink">+ Quick note</button>
              <Link href="/notes" className="text-sm text-muted hover:text-ink">View all</Link>
            </div>
          </div>
          {notes.length === 0 ? (
            <p className="rounded-2xl bg-soft p-6 text-center text-sm text-muted">Nothing yet. Press &quot;n&quot; anywhere in the app, or click the notes button, to jot something down — it can be attached to any interview, round or plan item.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {notes.slice(0, 3).map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, value, label, small }: { icon: React.ReactNode; value: React.ReactNode; label: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-soft p-3">
      <div className="mx-auto mb-1 grid w-fit place-items-center text-muted">{icon}</div>
      <div className={`font-semibold ${small ? "text-sm leading-6" : "text-2xl"}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
