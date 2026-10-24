"use client";

import Link from "next/link";
import { ArrowRight, Check, Lock } from "lucide-react";
import { dueText } from "@/components/org/api";
import { Card } from "@/components/Shell";
import { useAllPacks, useMyPlans, useReports } from "@/lib/db";
import { recommendPack } from "@/lib/recommend";

// "Your plan": the stages an organisation has set, in order, with where you are (plans/b2b-college.md
// B.6). Nothing shows unless you've been given a plan. Personal practice stays available as ever.

export function YourPlan() {
  const { data: plans = [] } = useMyPlans();
  const { byId, all } = useAllPacks();
  const { data: reports = [] } = useReports();
  if (!plans.length) return null;
  // Where a stage has been tried without reaching its score, point at the round that targets their weakest skill.
  const focus = recommendPack(reports, all.filter((p) => p.source !== "quick" && !p.archived));

  return (
    <>
      {plans.map((plan) => {
        const done = plan.stages.filter((s) => s.complete).length;
        return (
          <Card key={plan.runId} className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{plan.name} <span className="font-normal text-muted">· from {plan.orgName}</span></h2>
              <span className="text-sm tabular-nums text-muted">{done} of {plan.stages.length} stages done</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-soft" aria-hidden="true">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / plan.stages.length) * 100}%` }} />
            </div>
            <ol className="grid gap-1">
              {plan.stages.map((s) => (
                <li key={s.assignmentId} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm ${s.current ? "bg-accent-soft" : ""}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.complete ? "bg-ok text-on-status" : "bg-soft text-muted"}`} aria-hidden="true">
                      {s.complete ? <Check size={12} /> : s.locked ? <Lock size={11} /> : <span className="text-[10px]">{s.position}</span>}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate ${s.locked ? "text-muted" : "font-medium"}`}>{s.title.split(" · ").slice(1).join(" · ") || s.title}</span>
                      <span className="block text-xs text-muted">
                        {byId(s.packId)?.title ?? "Round"} · {Math.min(s.done, s.target)} of {s.target} done
                        {s.gateScore !== null ? ` · score ${s.gateScore}+ to count${!s.complete && s.bestScore !== null ? `, your best is ${s.bestScore}` : ""}` : ""}
                        {s.dueAt && !s.complete ? ` · ${dueText(s.dueAt)}` : ""}
                        {!s.mandatory ? " · optional" : ""}
                        {s.locked ? " · finish the stage above first" : ""}
                      </span>
                      {s.waived && <span className="block text-xs text-muted">Waived by your coach{s.waivedReason ? `: ${s.waivedReason}` : ""}.</span>}
                      {!s.complete && !s.locked && s.gateScore !== null && s.attempts >= 2 && (
                        <span className="block text-xs">
                          <Link className="text-accent hover:underline" href={`/practice?pack=${focus.pack.id}`}>Try {focus.pack.title} first</Link>
                          <span className="text-muted"> · {focus.reason}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  {!s.complete && !s.locked && (
                    <Link href={`/practice?pack=${s.packId}&assignment=${s.assignmentId}`} className={`btn ${s.current ? "btn-primary" : "btn-ghost"} !py-1.5`}>
                      {s.current ? "Start" : "Practise"} <ArrowRight size={14} />
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </>
  );
}
