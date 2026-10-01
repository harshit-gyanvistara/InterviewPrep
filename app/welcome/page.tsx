import Link from "next/link";
import { BarChart3, Compass, Mic, Sparkles } from "lucide-react";

const PILLARS = [
  { icon: Compass, title: "Prepare", text: "Tell us your role, companies and interview date. Get a week-by-week plan built from your weak spots." },
  { icon: Mic, title: "Practice", text: "Speak with a live AI interviewer that asks follow-ups, reads your resume and pushes back like a real one." },
  { icon: BarChart3, title: "Improve", text: "Scored reports with quoted evidence, a stronger sample answer for every question, and a clear next step." },
];

const STEPS = [
  "Set up your profile in 2 minutes",
  "Check your mic and camera",
  "Take a baseline mock interview",
  "Review your report and fix the top 3 issues",
  "Repeat until you're consistently strong",
];

export default function Welcome() {
  return (
    <div className="mx-auto max-w-5xl">
      <section className="py-8 text-center sm:py-14">
        <span className="inline-flex items-center gap-2 rounded-full bg-soft px-4 py-1.5 text-sm text-muted">
          <Sparkles size={14} /> Interview practice that feels real
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-light tracking-tight sm:text-6xl">
          Prepare. Practice. <span className="font-semibold">Land the job.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-muted">
          Mock interviews with an AI interviewer that talks, listens, interrupts and follows up — then tells you exactly what to fix.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/onboarding" className="btn btn-primary !px-7 !py-3">Start free</Link>
        </div>
        <p className="mt-3 text-xs text-muted">No account needed. Your data stays in this browser.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-3xl bg-card p-6">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-ink"><Icon size={20} /></span>
            <h2 className="mt-4 text-xl font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-3xl bg-card p-6 sm:p-8">
        <h2 className="text-2xl font-light">How it works</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s} className="rounded-2xl bg-soft p-4 text-sm">
              <span className="mb-2 grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-ink">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
