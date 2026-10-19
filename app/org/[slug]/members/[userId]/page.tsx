"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, PageTitle } from "@/components/Shell";
import { PageSkeleton } from "@/components/Skeleton";
import { orgApi, roleLabel } from "@/components/org/api";
import { useAllPacks } from "@/lib/db";
import type { MemberDetail } from "@/lib/orgDashboard";
import { SHARE_LEVEL_ADMIN_TEXT, SHARE_LEVEL_TEXT } from "@/lib/permissions";

// One member's practice for the organisation (plans/m2-org.md O.6), at the level they chose to
// share. Opening this page is recorded in the org's audit log.

export default function OrgMember() {
  const { slug, userId } = useParams<{ slug: string; userId: string }>();
  const { byId } = useAllPacks();
  const [data, setData] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgApi<MemberDetail>(`/api/orgs/${slug}/members/${userId}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this member."));
  }, [slug, userId]);

  const back = <Link href={`/org/${slug}`} className="text-sm text-muted hover:text-ink">← Back to the organisation</Link>;
  if (error) return <div className="mx-auto grid max-w-4xl gap-3">{back}<Card><p className="text-sm text-muted">{error}</p></Card></div>;
  if (!data) return <PageSkeleton />;
  const m = data.member;
  const transcript = (sessionId: string) => data.transcripts?.find((t) => t.sessionId === sessionId);

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        {back}
        <PageTitle title={m.email ?? "Member"} sub={`${roleLabel(m.role)} · shares: ${SHARE_LEVEL_TEXT[m.shareLevel].title.toLowerCase()}`} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="!p-4"><div className="text-xs text-muted">Mocks for this organisation</div><div className="text-2xl font-semibold">{m.mocks}</div></Card>
        <Card className="!p-4"><div className="text-xs text-muted">Last practice</div><div className="text-2xl font-semibold">{m.lastPracticeAt ? new Date(m.lastPracticeAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Never"}</div></Card>
        <Card className="!p-4"><div className="text-xs text-muted">Readiness</div><div className="text-2xl font-semibold">{m.readiness ?? "–"}</div></Card>
      </div>
      <p className="text-xs text-muted">{SHARE_LEVEL_ADMIN_TEXT[m.shareLevel]} Viewing this page is recorded in the organisation&apos;s audit log.</p>

      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Mocks</h2>
        {data.reports.length === 0 ? (
          <p className="text-sm text-muted">No practice for this organisation yet.</p>
        ) : (
          data.reports.map((r) => {
            const t = transcript(r.sessionId);
            return (
              <div key={r.sessionId} className="grid gap-2 border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{byId(r.packId)?.title ?? r.packId}</span>
                  <span className="text-muted">
                    {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    {r.verdict && ` · ${r.verdict === "Too short" ? "too short to score" : `${r.overall} · ${r.verdict}`}`}
                  </span>
                </div>
                {r.dimensions && r.verdict !== "Too short" && (
                  <div className="text-muted">
                    {r.dimensions.filter((d) => d.assessed !== false).map((d) => `${d.name} ${d.score}`).join(" · ")}
                  </div>
                )}
                {t && (
                  <details className="rounded-lg bg-soft px-3 py-2">
                    <summary className="cursor-pointer text-muted">Transcript</summary>
                    <div className="mt-2 grid gap-1.5">
                      {t.messages.map((msg, i) => (
                        <p key={i}><b>{msg.role === "candidate" ? "Member" : "Interviewer"}:</b> {msg.text}</p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
