"use client";

import { Clock, HelpCircle, Lightbulb, ListChecks, Zap } from "lucide-react";
import { DeviceCheck } from "@/components/DeviceCheck";
import { Card } from "@/components/Shell";
import { PERSONAS } from "@/lib/packs";
import type { Pack, SessionConfig } from "@/lib/types";

const TIPS: Record<Pack["roundType"], string[]> = {
  behavioural: ["Use STAR: Situation, Task, Action, Result.", "Say “I”, not “we”. Own your part.", "Give numbers: time saved, users, marks, bugs fixed.", "Aim for 60–120 seconds per answer."],
  technical: ["Think aloud. Silence reads as being stuck.", "State assumptions before answering.", "Start with the simple version, then go deeper.", "If you don't know, say what you'd try."],
  coding: ["Restate the problem and ask about edge cases first.", "Explain your approach before you type.", "Write the brute force, then optimise.", "Finish by testing with an example and stating complexity."],
  hr: ["Keep answers crisp: 30–60 seconds.", "Research the company for one specific line.", "Be positive about relocation, shifts and learning.", "Have one real question ready to ask."],
};

export function Lobby({ pack, config, onJoin, onCancel }: { pack: Pack; config: SessionConfig; onJoin: () => void; onCancel: () => void }) {
  const persona = PERSONAS[config.persona];
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-light tracking-tight sm:text-5xl">{pack.title}</h1>
      <p className="mt-2 text-muted">{pack.company} · {pack.role}</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-5">
          <Card>
            <h2 className="mb-3 font-medium">Your interview</h2>
            <dl className={`grid gap-3 text-center text-sm ${config.questionCount ? "grid-cols-4" : "grid-cols-3"}`}>
              <div className="rounded-2xl bg-soft p-3"><dt className="text-xs text-muted">Interviewer</dt><dd className="font-medium">{persona.name}</dd><dd className="text-xs text-muted">{persona.label}</dd></div>
              <div className="rounded-2xl bg-soft p-3"><dt className="text-xs text-muted">Length</dt><dd className="flex items-center justify-center gap-1 font-medium"><Clock size={14} />{config.durationMin} min</dd></div>
              {config.questionCount && (
                <div className="rounded-2xl bg-soft p-3"><dt className="text-xs text-muted">Questions</dt><dd className="flex items-center justify-center gap-1 font-medium"><HelpCircle size={14} />~{config.questionCount}</dd></div>
              )}
              <div className="rounded-2xl bg-soft p-3"><dt className="text-xs text-muted">Mode</dt><dd className="flex items-center justify-center gap-1 font-medium">{config.pressure ? <><Zap size={14} />Pressure</> : "Standard"}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-medium"><ListChecks size={16} /> What to expect</h2>
            <ul className="grid gap-2 text-sm text-muted">
              <li>The interviewer greets you, then asks one question at a time.</li>
              <li>Answer out loud (mic) or type. Speech fills the answer box as you talk — nothing sends until you tap Send, so you can always edit first.</li>
              <li>Expect follow-ups. Vague answers get probed.</li>
              <li>You&apos;ll be scored on: {pack.rubric.join(", ")}.</li>
              <li>The clock runs from the moment you join. No pausing.</li>
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 flex items-center gap-2 font-medium"><Lightbulb size={16} /> Tips for this round</h2>
            <ul className="grid gap-2 text-sm text-muted">{TIPS[pack.roundType].map((t) => (<li key={t}>• {t}</li>))}</ul>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <h2 className="mb-3 font-medium">Device check</h2>
            <DeviceCheck />
          </Card>
          <div className="flex gap-3">
            <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
            <button onClick={onJoin} className="btn btn-primary flex-1 !py-3">Join interview</button>
          </div>
        </div>
      </div>
    </div>
  );
}
