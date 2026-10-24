"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { Card } from "@/components/Shell";
import { useAllPacks } from "@/lib/db";
import type { MemberPlans } from "@/lib/orgWaivers";
import { orgApi } from "./api";

// A member's plans as staff see them, with waivers (plans/b2b-college.md B.9). Progress against score
// gates follows the member's sharing choice. Waiving needs a reason, which the member sees; it never
// changes any score. People with assignments.create can waive (the server limits a coach to their own part).

export function MemberPlanCard({ slug, userId, canWaive }: { slug: string; userId: string; canWaive: boolean }) {
  const { byId } = useAllPacks();
  const [data, setData] = useState<MemberPlans | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await orgApi<MemberPlans>(`/api/orgs/${slug}/members/${userId}/plan`));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load their plan.");
    }
  }, [slug, userId]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setAsking(null);
      setReason("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    }
  };

  if (!data) return msg ? <Card><p className="text-sm text-muted">{msg}</p></Card> : null;
  if (data.hidden) return <Card><p className="text-sm text-muted">Their progress against plan score targets isn&apos;t shown, because they share less than scores.</p></Card>;
  if (!data.plans.length) return null;

  return (
    <>
      {data.plans.map((plan) => (
        <Card key={plan.runId} className="grid gap-3">
          <h2 className="text-sm font-semibold">{plan.name}</h2>
          <ol className="grid gap-2 text-sm">
            {plan.stages.map((s) => (
              <li key={s.assignmentId} className="grid gap-2 border-b border-line pb-2 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className={`grid h-5 w-5 place-items-center rounded-full ${s.complete ? "bg-ok text-on-status" : "bg-soft text-muted"}`} aria-hidden="true">
                      {s.complete ? <Check size={12} /> : s.locked ? <Lock size={11} /> : <span className="text-[10px]">{s.position}</span>}
                    </span>
                    <span>
                      <b className="font-medium">{s.title.split(" · ").slice(1).join(" · ") || s.title}</b>
                      <span className="text-muted"> · {byId(s.packId)?.title ?? "Round"} · {Math.min(s.done, s.target)} of {s.target}
                        {s.gateScore !== null ? ` · needs ${s.gateScore}+${s.bestScore !== null ? `, best ${s.bestScore}` : ""}` : ""}
                        {s.attempts > 0 ? ` · ${s.attempts} attempt${s.attempts === 1 ? "" : "s"}` : ""}
                        {s.waived ? " · waived" : ""}
                      </span>
                    </span>
                  </span>
                  {canWaive && (s.waived ? (
                    <button className="text-muted hover:text-ink" onClick={() => act(() => orgApi(`/api/orgs/${slug}/members/${userId}/waivers`, { method: "DELETE", body: { assignmentId: s.assignmentId } }))}>Undo waiver</button>
                  ) : !s.complete ? (
                    <button className="text-muted hover:text-ink" onClick={() => setAsking(asking === s.assignmentId ? null : s.assignmentId)}>Waive</button>
                  ) : null)}
                </div>
                {s.waived && s.waivedReason && <p className="pl-7 text-xs text-muted">Reason: {s.waivedReason}</p>}
                {asking === s.assignmentId && (
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <input className="input max-w-sm" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The member will see this." aria-label="Reason for waiving" />
                    <button className="btn btn-primary !py-1.5" disabled={reason.trim().length < 3} onClick={() => act(() => orgApi(`/api/orgs/${slug}/members/${userId}/waivers`, { method: "POST", body: { assignmentId: s.assignmentId, reason } }))}>Waive</button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </>
  );
}
