import { Mic } from "lucide-react";
import { StartCta } from "./StartCta";

// Three real steps, in order: the numbering is the sequence a new user goes through.
const STEPS = [
  { title: "Tell us the job", text: "Your role, target companies and interview date. Paste a job description and rounds are built around it." },
  { title: "Practise out loud", text: "A live AI interviewer asks, listens and follows up on vague answers, like a real panel would." },
  { title: "Fix what matters", text: "A scored report with quotes from your own answers, the three things to fix, and a plan for the weeks ahead." },
];

const FIELDS = ["Software", "Business", "Healthcare", "Design", "Teaching", "Sales"];

/** A small, static picture of the product: the interviewer's question and the report it leads to. */
function ProductPreview() {
  return (
    <div className="relative grid gap-3" aria-hidden="true">
      <div className="rounded-xl border border-line bg-card p-4 shadow-float">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">L</span>
          <div className="min-w-0">
            <div className="text-sm font-medium">Liam · Behavioural round</div>
            <div className="text-xs text-muted">Question 3 of 6 · 08:42</div>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Live
          </span>
        </div>
        <p className="mt-3 text-[15px] leading-6">&ldquo;You said the API handled 2,000 sign-ups. What broke first, and what did you change?&rdquo;</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-soft px-3 py-2 text-xs text-muted">
          <Mic size={14} className="text-accent" /> Your turn. Answer out loud or type.
        </div>
      </div>

      <div className="ml-6 rounded-xl border border-line bg-card p-4 shadow-float sm:ml-12">
        <div className="flex items-center gap-4">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center">
            <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
              <circle cx="32" cy="32" r="27" fill="none" stroke="var(--soft)" strokeWidth="6" />
              <circle cx="32" cy="32" r="27" fill="none" stroke="var(--ok)" strokeWidth="6" strokeLinecap="round" strokeDasharray="169.6" strokeDashoffset="44" />
            </svg>
            <span className="text-lg font-semibold tabular-nums">74</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">Solid fundamentals. Name your trade-offs.</div>
            <div className="mt-1 text-xs text-muted">Fix first: close each answer with the result.</div>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          {[
            ["Technical depth", 81, "bg-ok"],
            ["Trade-off reasoning", 54, "bg-warn"],
            ["Structure", 48, "bg-danger"],
          ].map(([label, w, c]) => (
            <div key={label as string} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted">{label}</span>
              <span className="tabular-nums">{((w as number) / 10).toFixed(1)}</span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-soft">
                <span className={`block h-full rounded-full ${c}`} style={{ width: `${w}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Welcome() {
  return (
    <div className="grid gap-16 pb-8 sm:gap-24">
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-10">
        <div>
          <span className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted">
            Mock interviews for any profession
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
            Walk into your interview <span className="text-accent">already practised.</span>
          </h1>
          <p className="mt-5 max-w-[34rem] text-[17px] leading-7 text-muted">
            Talk to an AI interviewer that listens, follows up and pushes back. Then get a scored report that shows exactly what to fix before the real one.
          </p>
          <StartCta />
        </div>
        <ProductPreview />
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-card p-5">
              <span className="text-sm font-semibold tabular-nums text-accent">Step {i + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Built for your field, not just tech</h2>
          <p className="mt-1 text-sm text-muted">Questions and scoring adapt to the role you&apos;re aiming for.</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {FIELDS.map((f) => (
            <li key={f} className="rounded-full bg-soft px-3 py-1 text-sm text-muted">{f}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
