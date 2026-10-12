"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, NotebookPen, Repeat, StickyNote } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { NoteCard } from "@/components/notes/NoteCard";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { db, uid, useAllPacks, useNotesFor, useProfile, useQuery, useReports } from "@/lib/db";
import { recommendPack } from "@/lib/recommend";
import { visibleBuiltInPacks, PERSONAS } from "@/lib/packs";
import { verdictColor } from "@/lib/analysis";
import { useNotesPanel } from "@/lib/notesContext";
import { createPage, ensureBinder, reportToHtml } from "@/lib/cortex";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openPanel } = useNotesPanel();
  const { data: profile } = useProfile();
  const { data: allReports = [] } = useReports();
  const { custom: customPacks, catalog, byId } = useAllPacks();
  const { data, loading } = useQuery(async () => {
    const session = await db.sessions.get(id);
    const report = (await db.reports.list()).find((r) => r.sessionId === id);
    return { session, report };
  }, [id]);

  const { session, report } = data ?? {};
  const sessionLink = session && report ? { type: "session" as const, id: session.id, label: byId(report.packId)?.title ?? "Interview" } : undefined;
  const { notes: sessionNotes } = useNotesFor(sessionLink);

  if (loading) return null;
  if (!session || !report)
    return (
      <Card>
        <p className="text-sm">Report not found.</p>
        <Link href="/" className="btn btn-primary mt-4">Back to dashboard</Link>
      </Card>
    );

  const pack = byId(report.packId);
  const packs = profile ? [...customPacks, ...visibleBuiltInPacks(profile, catalog)] : customPacks;
  const rec = packs.length ? recommendPack(allReports, packs) : undefined;

  const startSession = async (packId: string, cfg = session.config) => {
    const sid = uid();
    await db.sessions.put({ id: sid, config: { ...cfg, packId, durationMin: packId === cfg.packId ? cfg.durationMin : (byId(packId)?.durationMin ?? cfg.durationMin) }, messages: [], code: "", startedAt: Date.now(), status: "lobby" });
    router.push(`/interview/${sid}`);
  };

  const saveToCortex = async () => {
    const binder = await ensureBinder("Interview Reports", "📋");
    const page = await createPage(binder.id, {
      title: `${pack?.title ?? "Interview"} — ${report.overall}/100`,
      icon: "📋",
      contentHtml: reportToHtml({ packTitle: pack?.title ?? "Interview", overall: report.overall, verdict: report.verdict, summary: report.summary, topFixes: report.topFixes, dimensions: report.dimensions, answerReviews: report.answerReviews }),
    });
    router.push(`/cortex?binder=${binder.id}&page=${page.id}`);
  };

  const persona = PERSONAS[session.config.persona];
  const s = report.signals;

  return (
    <div>
      <PageTitle title="Interview report" sub={`${pack?.title} · ${persona.name} (${persona.label}) · ${new Date(report.createdAt).toLocaleString()}`} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="text-center">
          <div className="text-7xl font-light">{report.overall}</div>
          <div className="text-sm text-muted">out of 100</div>
          <div className={`mt-2 text-lg font-medium ${verdictColor(report.verdict)}`}>{report.verdict}</div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-lg font-medium">Summary</h2>
          <p className="text-sm leading-relaxed text-muted">{report.summary}</p>
          <h3 className="mb-2 mt-5 flex items-center gap-2 font-medium"><AlertTriangle size={16} /> Top 3 fixes</h3>
          <ol className="grid gap-2 text-sm">
            {report.topFixes.map((f, i) => (
              <li key={i} className="rounded-2xl bg-soft p-3"><b className="mr-2">{i + 1}.</b>{f}</li>
            ))}
          </ol>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-medium">Rubric scores</h2>
          <div className="grid gap-4">
            {report.dimensions.map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span>{d.score}/10</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-soft">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(10, d.score)) * 10}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-muted">{d.feedback}</p>
                {d.evidence && <p className="mt-1 border-l-2 border-line pl-3 text-xs italic text-muted">“{d.evidence}”</p>}
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium"><CheckCircle2 size={18} className="text-ok" /> Strengths</h2>
            <ul className="grid gap-2 text-sm">
              {report.strengths.map((x, i) => (<li key={i} className="rounded-2xl bg-soft p-3">{x}</li>))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-medium">Speaking signals</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Sig label="Answers" value={s.candidateTurns} />
              <Sig label="Words / answer" value={s.avgWordsPerAnswer} />
              <Sig label="Filler words" value={s.fillerCount} />
              <Sig label="Fillers / 100 words" value={s.fillerRate} />
            </dl>
            {s.topFillers.length > 0 && (
              <p className="mt-3 text-xs text-muted">Most used: {s.topFillers.map((f) => `“${f.word}” ×${f.count}`).join(", ")}</p>
            )}
            <p className="mt-2 text-xs text-muted">From the transcript. Ideal answers are ~60–150 words.</p>
          </Card>
        </div>

        <Card className="lg:col-span-3">
          <h2 className="mb-4 text-lg font-medium">Answer-by-answer review</h2>
          <div className="grid gap-4">
            {report.answerReviews.map((a, i) => (
              <div key={i} className="rounded-2xl bg-soft p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">Q{i + 1}. {a.question}</p>
                  <span className="shrink-0 rounded-full bg-card px-3 py-1 text-xs">{a.score}/10</span>
                </div>
                <p className="mt-2 text-muted"><b className="text-ink">You said:</b> {a.answerSummary}</p>
                <p className="mt-2 text-muted"><b className="text-ink">Feedback:</b> {a.feedback}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-hl p-3">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">A stronger version of your answer</div>
                    {a.betterAnswer}
                  </div>
                  <div className="rounded-xl bg-card p-3">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">What the interviewer expected</div>
                    {a.expectedAnswer}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-medium"><StickyNote size={18} /> Notes on this interview</h2>
          <p className="mb-4 text-sm text-muted">Anything you want to remember — jot it here, or hover any line in the transcript below to save it as a note.</p>
          <div className="mb-4 rounded-2xl bg-soft p-4">
            <NoteEditor initialLink={sessionLink} onDone={() => {}} autoFocus={false} />
          </div>
          {sessionNotes.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sessionNotes.map((n) => (
                <NoteCard key={n.id} note={n} />
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <h2 className="mb-1 text-lg font-medium">What next?</h2>
          <p className="mb-4 text-sm text-muted">Fix the top three issues, then go again while they&apos;re fresh.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button onClick={() => startSession(report.packId)} className="rounded-2xl bg-accent p-4 text-left text-sm text-accent-ink">
              <Repeat size={16} className="mb-2" /><b>Retry this round</b><span className="mt-1 block opacity-80">Same setup, aim to beat {report.overall}.</span>
            </button>
            {rec && (
              <button onClick={() => startSession(rec.pack.id)} className="rounded-2xl bg-soft p-4 text-left text-sm">
                <b>Try: {rec.pack.title}</b><span className="mt-1 block text-muted">{rec.reason}</span>
              </button>
            )}
            <button onClick={saveToCortex} className="rounded-2xl bg-soft p-4 text-left text-sm">
              <NotebookPen size={16} className="mb-2" /><b>Save to Cortex</b><span className="mt-1 block text-muted">Turn this into a study page you can annotate.</span>
            </button>
            <Link href="/prepare" className="rounded-2xl bg-soft p-4 text-sm"><b>Update my plan</b><span className="mt-1 block text-muted">Regenerate the roadmap with this result.</span></Link>
            <Link href="/" className="rounded-2xl bg-soft p-4 text-sm"><b>Back to dashboard</b><span className="mt-1 block text-muted">See your goal and streak.</span></Link>
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <details>
            <summary className="cursor-pointer text-lg font-medium">Full transcript</summary>
            <div className="mt-4 grid gap-2 text-sm">
              {session.messages.map((m) => (
                <p key={m.id} className="group flex items-start justify-between gap-2">
                  <span><b>{m.role === "candidate" ? "You" : persona.name}:</b> <span className="text-muted">{m.text}</span></span>
                  <button
                    onClick={() => sessionLink && openPanel({ filterLink: sessionLink, prefillBody: `"${m.text}"\n— ${m.role === "candidate" ? "you" : persona.name}` })}
                    aria-label="Save as note"
                    title="Save as note"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted opacity-0 hover:bg-soft group-hover:opacity-100"
                  >
                    <StickyNote size={13} />
                  </button>
                </p>
              ))}
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}

function Sig({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-soft p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
    </div>
  );
}
