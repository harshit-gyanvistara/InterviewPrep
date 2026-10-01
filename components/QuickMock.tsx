"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ListChecks, Loader2, Sparkles, Timer, Zap } from "lucide-react";
import { Card } from "@/components/Shell";
import { db, uid } from "@/lib/db";
import { PERSONAS, buildMixedPack } from "@/lib/packs";
import type { Pack, Persona, Settings } from "@/lib/types";

/**
 * Lets the person pick one or more existing rounds, mix them into a single session, and set
 * their own question count and timer independently — a faster, more flexible alternative to
 * picking a single fixed-length round.
 */
export function QuickMockBuilder({ packs, settings }: { packs: Pack[]; settings: Settings }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(packs[0] ? [packs[0].id] : []));
  const [questionCount, setQuestionCount] = useState(6);
  const [minutes, setMinutes] = useState(15);
  const [persona, setPersona] = useState<Persona>(settings.defaultPersona);
  const [pressure, setPressure] = useState(settings.defaultPressure);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async () => {
    const chosen = packs.filter((p) => selected.has(p.id));
    if (chosen.length === 0) {
      setError("Pick at least one round to build your mock from.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const built = buildMixedPack(chosen, { questionCount, durationMin: minutes });
      const pack: Pack = { ...built, id: `mixed-${uid()}`, source: "quick", createdAt: Date.now() };
      await db.customPacks.put(pack);
      const sessionId = uid();
      await db.sessions.put({
        id: sessionId,
        config: { packId: pack.id, persona, durationMin: minutes, pressure, questionCount },
        messages: [],
        code: "",
        startedAt: Date.now(),
        status: "lobby",
      });
      router.push(`/interview/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the quick mock.");
    } finally {
      setBusy(false);
    }
  };

  if (packs.length === 0) return <Card><p className="text-sm text-muted">No rounds available to mix yet.</p></Card>;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h3 className="mb-1 flex items-center gap-2 font-medium"><ListChecks size={16} /> Pick one or more rounds</h3>
        <p className="mb-3 text-sm text-muted">Select just one for a shorter version of it, or several to mix them into one session that jumps between question styles.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {packs.map((p) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={`flex items-start gap-3 rounded-2xl p-3 text-left text-sm transition ${on ? "bg-accent text-accent-ink" : "bg-soft hover:opacity-80"}`}
              >
                {on ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <Circle size={18} className="mt-0.5 shrink-0 opacity-40" />}
                <span>
                  <span className="font-medium">{p.title}</span>
                  <span className={`mt-0.5 block text-xs ${on ? "opacity-80" : "text-muted"}`}>{p.company} · {p.role}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">{selected.size} round{selected.size === 1 ? "" : "s"} selected.</p>
      </Card>

      <div className="grid content-start gap-5">
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-medium"><Timer size={16} /> Length</h3>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted">Number of questions: {questionCount}</span>
            <input type="range" min={3} max={20} step={1} value={questionCount} onChange={(e) => setQuestionCount(+e.target.value)} />
          </label>
          <label className="mt-4 grid gap-1.5 text-sm">
            <span className="text-muted">Timer: {minutes} min</span>
            <input type="range" min={5} max={60} step={5} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
          </label>
          <p className="mt-2 text-xs text-muted">Both are set independently. The interviewer wraps up once it has asked about that many questions, or when time runs out — whichever comes first.</p>
        </Card>

        <Card>
          <h3 className="mb-3 font-medium">Interviewer</h3>
          <div className="grid gap-2">
            {(Object.keys(PERSONAS) as Persona[]).map((k) => (
              <button key={k} onClick={() => setPersona(k)} className={`rounded-2xl p-3 text-left text-sm ${persona === k ? "bg-accent text-accent-ink" : "bg-soft"}`}>
                <div className="font-medium">{PERSONAS[k].name} · {PERSONAS[k].label}</div>
                <div className={persona === k ? "opacity-80" : "text-muted"}>{PERSONAS[k].blurb}</div>
              </button>
            ))}
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={pressure} onChange={(e) => setPressure(e.target.checked)} className="mt-1" />
            <span>
              <span className="flex items-center gap-1 font-medium"><Zap size={14} /> Pressure mode</span>
              <span className="text-muted">Interruptions, a curveball question and no hints.</span>
            </span>
          </label>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <button onClick={start} disabled={busy || selected.size === 0} className="btn btn-primary mt-5 w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Build & continue to lobby
          </button>
        </Card>
      </div>
    </div>
  );
}
