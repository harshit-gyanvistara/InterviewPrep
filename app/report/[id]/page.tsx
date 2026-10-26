"use client";

import { PageSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, NotebookPen, Repeat, StickyNote } from "lucide-react";
import { Card } from "@/components/Shell";
import { NoteCard } from "@/components/notes/NoteCard";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { TonePill } from "@/components/ScoreBadge";
import { db, practisingFor, uid, useAllPacks, useMyOrgs, useNotesFor, useProfile, useQuery, useReports, useSettings } from "@/lib/db";
import { recommendPack } from "@/lib/recommend";
import { visibleBuiltInPacks, PERSONAS } from "@/lib/packs";
import { isScored, scoreTone, verdictTone, type Tone } from "@/lib/analysis";
import { useNotesPanel } from "@/lib/notesContext";
import { createPage, ensureBinder, reportToHtml } from "@/lib/cortex";
import { shortDate } from "@/lib/format";

const STROKE: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" };
const FILL: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" };

/** The summary's first sentence becomes the headline; the rest reads underneath it. */
function splitSummary(summary: string): [string, string] {
  const m = summary.match(/^(.+?[.!?])\s+([\s\S]*)$/);
  return m ? [m[1], m[2]] : [summary, ""];
}

function ScoreRing({ score, tone }: { score: number; tone: Tone }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-32 w-32 shrink-0 place-items-center" role="img" aria-label={`Overall score ${score} out of 100`}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--soft)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={STROKE[tone]} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)} />
      </svg>
      <div className="text-center">
        <div className="text-[38px] font-semibold leading-none tracking-tight tabular-nums">{score}</div>
        <div className="mt-1 text-xs text-muted">out of 100</div>
      </div>
    </div>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openPanel } = useNotesPanel();
  const { data: profile } = useProfile();
  const { data: allReports = [] } = useReports();
  const { custom: customPacks, catalog, byId } = useAllPacks();
  const { settings } = useSettings();
  const { data: myOrgs } = useMyOrgs();
  const { data, loading } = useQuery(async () => {
    const session = await db.sessions.get(id);
    const report = (await db.reports.list()).find((r) => r.sessionId === id);
    return { session, report };
  }, [id]);

  const { session, report } = data ?? {};
  const sessionLink = session && report ? { type: "session" as const, id: session.id, label: byId(report.packId)?.title ?? "Interview" } : undefined;
  const { notes: sessionNotes } = useNotesFor(sessionLink);

  if (loading) return <PageSkeleton />;
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
    // "Practise again" follows the current switcher, not the org the old session was for.
    const { orgId: _previous, ...rest } = cfg;
    void _previous;
    const org = practisingFor(settings, myOrgs);
    await db.sessions.put({ id: sid, config: { ...rest, ...(org ? { orgId: org.id } : {}), packId, durationMin: packId === cfg.packId ? cfg.durationMin : (byId(packId)?.durationMin ?? cfg.durationMin) }, messages: [], code: "", startedAt: Date.now(), status: "lobby" });
    router.push(`/interview/${sid}`);
  };

  const saveToCortex = async () => {
    const binder = await ensureBinder("Interview Reports", "📋");
    const page = await createPage(binder.id, {
      title: `${pack?.title ?? "Interview"} — ${isScored(report) ? `${report.overall}/100` : "too short to score"}`,
      icon: "📋",
      contentHtml: reportToHtml({ packTitle: pack?.title ?? "Interview", overall: report.overall, verdict: report.verdict, summary: report.summary, topFixes: report.topFixes, dimensions: report.dimensions, answerReviews: report.answerReviews }),
    });
    router.push(`/cortex?binder=${binder.id}&page=${page.id}`);
  };

  const persona = PERSONAS[session.config.persona];
  const s = report.signals;
  const tone = verdictTone(report.verdict);
  const [headline, rest] = splitSummary(report.summary);
  const minutes = session.endedAt ? Math.max(1, Math.round((session.endedAt - session.startedAt) / 60000)) : null;
  const date = shortDate(report.createdAt);
  // Quotes from the candidate's own answers, from the dimensions that have one.
  const quotes = report.dimensions.filter((d) => d.evidence?.trim());
  // Too few answers to score fairly (plans/honest-scoring.md): no score ring, say how much was answered.
  const scored = isScored(report);

  return (
    <div className="grid gap-5">
      <article className="overflow-hidden rounded-xl bg-card shadow-float">
        <header className="grid items-center gap-6 border-b border-line p-6 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-7">
          {scored ? (
            <ScoreRing score={report.overall} tone={tone} />
          ) : (
            <div className="grid h-32 w-32 shrink-0 place-content-center gap-1 rounded-full border-[10px] border-soft text-center">
              <span className="text-sm font-semibold text-warn">Too short<br />to score</span>
              {report.coverage && <span className="text-xs text-muted">{report.coverage.answered} of ~{report.coverage.expected} answered</span>}
            </div>
          )}
          <div className="grid gap-2.5">
            <div className="flex flex-wrap gap-2">
              <TonePill tone={tone}>{report.verdict}</TonePill>
              <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs font-medium text-muted">{pack?.title ?? "Interview"}</span>
              <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs font-medium text-muted">
                {date}{minutes ? ` · ${minutes} min` : ""} · {persona.name} ({persona.label})
              </span>
            </div>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{headline}</h1>
            {rest && <p className="max-w-[64ch] text-muted">{rest}</p>}
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_1.3fr]">
          <section className="grid content-start gap-4 border-b border-line p-6 sm:p-7 lg:border-b-0 lg:border-r">
            <h2 className="text-sm font-semibold">By skill</h2>
            {report.dimensions.map((d) => {
              const t = scoreTone(d.score * 10);
              const seen = d.assessed !== false;
              return (
                <div key={d.name} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{d.name}</span>
                    {seen ? <span className="tabular-nums">{d.score.toFixed(1)}</span> : <span className="text-xs text-muted">Not enough evidence</span>}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-soft">
                    {seen && <div className={`h-full rounded-full ${FILL[t]}`} style={{ width: `${Math.max(0, Math.min(10, d.score)) * 10}%` }} />}
                  </div>
                  {d.feedback && <p className="text-[13px] leading-5 text-muted">{d.feedback}</p>}
                </div>
              );
            })}
          </section>

          <section className="grid content-start gap-6 p-6 sm:p-7">
            <div className="grid gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-ok" /> What went well</h2>
              {report.strengths.map((x, i) => (
                <div key={i} className="border-l-2 border-line pl-4 text-sm font-medium">{x}</div>
              ))}
            </div>
            <div className="grid gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-warn" /> Fix these {report.topFixes.length}</h2>
              {report.topFixes.map((f, i) => (
                <div key={i} className="border-l-2 border-line pl-4 text-sm font-medium">{i + 1}. {f}</div>
              ))}
            </div>
            {quotes.length > 0 && (
              <div className="grid gap-3">
                <h2 className="text-sm font-semibold">From your answers</h2>
                {quotes.slice(0, 3).map((d) => (
                  <figure key={d.name} className="border-l-2 border-accent pl-4">
                    <blockquote className="text-sm italic text-muted">&ldquo;{d.evidence}&rdquo;</blockquote>
                    <figcaption className="mt-1 text-xs text-muted">{d.name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-soft px-6 py-4 sm:px-7">
          <p className="text-sm text-muted">{rec && rec.pack.id !== report.packId ? `Next: ${rec.pack.title}. ${rec.reason}` : scored ? `Fix the top issues, then go again while they're fresh. Aim to beat ${report.overall}.` : "Answer at least 3 questions next time to get a full score."}</p>
          <button onClick={() => startSession(report.packId)} className="btn btn-primary"><Repeat size={15} /> Practise this round again</button>
        </footer>
      </article>

      <div className="grid items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <h2 className="mb-4 text-sm font-semibold">Answer by answer</h2>
          <div className="grid gap-4">
            {report.answerReviews.map((a, i) => (
              <div key={i} className="grid gap-2 border-t border-line pt-4 text-sm first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">Q{i + 1}. {a.question}</p>
                  {/* Reports saved before per-answer scores have none. */}
                  {typeof a.score === "number" && <TonePill tone={scoreTone(a.score * 10)}>{a.score}/10</TonePill>}
                </div>
                <p className="text-muted"><span className="font-medium text-ink">You said:</span> {a.answerSummary}</p>
                <p className="text-muted"><span className="font-medium text-ink">Feedback:</span> {a.feedback}</p>
                <div className={`mt-1 grid gap-3 ${a.expectedAnswer ? "sm:grid-cols-2" : ""}`}>
                  <div className="rounded-lg bg-accent-soft p-3">
                    <div className="mb-1 text-xs font-semibold text-accent">A stronger version</div>
                    {a.betterAnswer}
                  </div>
                  {a.expectedAnswer && (
                    <div className="rounded-lg border border-line p-3">
                      <div className="mb-1 text-xs font-semibold text-muted">What the interviewer expected</div>
                      {a.expectedAnswer}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Speaking signals</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Sig label="Answers" value={s.candidateTurns} />
              <Sig label="Words per answer" value={s.avgWordsPerAnswer} />
              <Sig label="Filler words" value={s.fillerCount} />
              <Sig label="Fillers per 100 words" value={s.fillerRate} />
            </dl>
            {s.topFillers.length > 0 && <p className="mt-3 text-xs text-muted">Most used: {s.topFillers.map((f) => `“${f.word}” ×${f.count}`).join(", ")}</p>}
            <p className="mt-2 text-xs text-muted">From the transcript. Strong answers are usually 60–150 words.</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">What next</h2>
            <div className="grid gap-1">
              {rec && rec.pack.id !== report.packId && (
                <NextLink onClick={() => startSession(rec.pack.id)} title={`Try ${rec.pack.title}`} text={rec.reason} />
              )}
              <NextLink onClick={saveToCortex} title="Save to Cortex" text="Turn this into a study page you can annotate." icon={<NotebookPen size={15} />} />
              <NextLink href="/prepare" title="Update my plan" text="Regenerate the roadmap with this result." />
              <NextLink href="/" title="Back to dashboard" text="See your goal and streak." />
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><StickyNote size={16} /> Notes on this interview</h2>
        <p className="mb-4 text-sm text-muted">Jot anything you want to remember, or hover a line in the transcript below to save it as a note.</p>
        <div className="mb-4 rounded-lg border border-line p-4">
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

      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Full transcript</summary>
          <div className="mt-4 grid gap-2 text-sm">
            {session.messages.map((m) => (
              <p key={m.id} className="group flex items-start justify-between gap-2">
                <span><b>{m.role === "candidate" ? "You" : persona.name}:</b> <span className="text-muted">{m.text}</span></span>
                <button
                  onClick={() => sessionLink && openPanel({ filterLink: sessionLink, prefillBody: `"${m.text}"\n— ${m.role === "candidate" ? "you" : persona.name}` })}
                  aria-label="Save as note"
                  title="Save as note"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted opacity-0 hover:bg-soft focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <StickyNote size={13} />
                </button>
              </p>
            ))}
          </div>
        </details>
      </Card>
    </div>
  );
}

function Sig({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function NextLink({ title, text, href, onClick, icon }: { title: string; text: string; href?: string; onClick?: () => void; icon?: React.ReactNode }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">{icon}{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{text}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-muted" />
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-soft";
  return href ? <Link href={href} className={cls}>{body}</Link> : <button onClick={onClick} className={cls}>{body}</button>;
}
