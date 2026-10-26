"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Card } from "@/components/Shell";
import { useConfirm } from "@/lib/dialogContext";
import { SHARE_LEVEL_TEXT, type Permission } from "@/lib/permissions";
import type { Dashboard, AuditEntry } from "@/lib/orgDashboard";
import { MIN_GROUP } from "@/lib/orgAnalytics";
import { orgApi, roleLabel } from "./api";
import { dateTime, shortDate } from "@/lib/format";

// The org admin dashboard (plans/m2-org.md O.6): overview, members, analytics and the audit log.
// The server already cut every member's data to their share level; this only lays it out.

function useDashboard(slug: string) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await orgApi<Dashboard>(`/api/orgs/${slug}/dashboard`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the dashboard.");
    }
  }, [slug]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return { data, error, load };
}

const day = (ms: number | null) => (ms ? shortDate(ms) : "Never");

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

const ExportButton = ({ slug }: { slug: string }) => (
  <a className="btn btn-ghost" href={`/api/orgs/${slug}/export`} download>
    <Download size={15} /> Export CSV
  </a>
);

export function OverviewPanel({ slug }: { slug: string }) {
  const { data, error } = useDashboard(slug);
  if (error) return <Card><p className="text-sm text-muted">{error}</p></Card>;
  if (!data) return <Card><p className="text-sm text-muted">Loading…</p></Card>;
  const o = data.overview;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={`${o.activeMembers}${o.seats !== null ? ` / ${o.seats}` : ""}`} hint={o.seats !== null ? "seats used" : "no seat limit"} />
        <Stat label="Mocks this period" value={`${o.mocks.used}${o.mocks.limit !== null ? ` / ${o.mocks.limit}` : ""}`} hint={o.mocks.limit === null ? "no limit" : o.mocks.resetsAt ? `resets ${day(o.mocks.resetsAt)}` : undefined} />
        <Stat label="Assignments" value={String(o.assignments.open)} hint={o.assignments.completionRate !== null ? `${o.assignments.completionRate}% completed` : undefined} />
        <Stat label="Quiet for 7+ days" value={String(o.inactive.length)} hint="members with no practice" />
      </div>
      {o.inactive.length > 0 && (
        <Card className="grid gap-2">
          <h2 className="text-sm font-semibold">Haven&apos;t practised in the last 7 days</h2>
          <p className="text-sm text-muted">{o.inactive.map((m) => m.email ?? "a member").join(", ")}</p>
        </Card>
      )}
      <div><ExportButton slug={slug} /></div>
    </div>
  );
}

export function MembersPanel({ slug, permissions, selfId }: { slug: string; permissions: Permission[]; selfId: string | null }) {
  const confirm = useConfirm();
  const { data, error, load } = useDashboard(slug);
  const [msg, setMsg] = useState<string | null>(null);
  const canManage = permissions.includes("members.manage");
  const canView = permissions.includes("members.view_reports");
  const roles = ["member", "coach", "admin", ...(permissions.includes("org.billing") ? ["owner"] : [])];

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
      await load();
    }
  };

  if (error) return <Card><p className="text-sm text-muted">{error}</p></Card>;
  if (!data) return <Card><p className="text-sm text-muted">Loading…</p></Card>;
  const cohortName = (id: string | null) => (id ? (data.cohorts.find((c) => c.id === id)?.name ?? "") : "");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Scores show only for members who chose to share them.</p>
        <ExportButton slug={slug} />
      </div>
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
      <Card className="overflow-x-auto !p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Sharing</th>
              <th className="px-4 py-3 font-medium">Mocks</th>
              <th className="px-4 py-3 font-medium">Last practice</th>
              <th className="px-4 py-3 font-medium">Readiness</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <div className="max-w-[220px] truncate">{m.email ?? m.userId}</div>
                  {m.cohortId && <div className="text-xs text-muted">{cohortName(m.cohortId)}</div>}
                </td>
                <td className="px-4 py-3">
                  {canManage && m.userId !== selfId && (m.role !== "owner" || roles.includes("owner")) ? (
                    <select
                      className="input w-auto !py-1"
                      aria-label={`Role for ${m.email ?? "member"}`}
                      value={m.role}
                      onChange={(e) => run(() => orgApi(`/api/orgs/${slug}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }))}
                    >
                      {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  ) : (
                    roleLabel(m.role)
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{SHARE_LEVEL_TEXT[m.shareLevel].title}</td>
                <td className="px-4 py-3 tabular-nums">{m.mocks}</td>
                <td className="px-4 py-3 text-muted">{day(m.lastPracticeAt)}</td>
                <td className="px-4 py-3 tabular-nums">{m.readiness ?? <span className="text-muted">–</span>}</td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-3">
                    {canView && <Link className="text-accent hover:underline" href={`/org/${slug}/members/${m.userId}`}>View</Link>}
                    {canManage && m.userId !== selfId && (m.role !== "owner" || roles.includes("owner")) && (
                      <button
                        className="text-muted hover:text-danger"
                        aria-label={`Remove ${m.email ?? "member"}`}
                        onClick={async () => {
                          if (!(await confirm({ message: `Remove ${m.email ?? "this member"}? They lose access to the organisation, and it loses access to their practice. Their own history stays with them.`, danger: true }))) return;
                          await run(() => orgApi(`/api/orgs/${slug}/members/${m.userId}`, { method: "DELETE" }));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function AnalyticsPanel({ slug }: { slug: string }) {
  const { data, error } = useDashboard(slug);
  if (error) return <Card><p className="text-sm text-muted">{error}</p></Card>;
  if (!data) return <Card><p className="text-sm text-muted">Loading…</p></Card>;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">Scores appear for groups with at least {MIN_GROUP} members sharing them, so no one can be singled out. Mocks too short to score are left out of averages.</p>
      {data.analytics.map((g) => (
        <Card key={`${g.cohortId}-${g.name}`} className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{g.name}</h2>
            <span className="text-sm text-muted">{g.members} member{g.members === 1 ? "" : "s"} · {g.activeLast7Days} active this week · {g.mocks} mock{g.mocks === 1 ? "" : "s"}</span>
          </div>
          {g.scores ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Readiness" value={String(g.scores.readiness)} hint="avg of each member's last 3" />
              <Stat label="Average score" value={String(g.scores.averageOverall)} />
              <Stat label="Filler words" value={g.scores.fillerRate !== null ? `${g.scores.fillerRate}` : "–"} hint="per 100 words" />
              <div className="grid gap-1 rounded-xl border border-line bg-card p-4">
                <div className="text-xs text-muted">Weakest skills</div>
                <div className="text-sm font-medium">{g.scores.weakestSkills.join(", ") || "–"}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">{g.sharingScores} member{g.sharingScores === 1 ? "" : "s"} sharing scores: not enough to show scores for this group.</p>
          )}
        </Card>
      ))}
    </div>
  );
}

export function AuditPanel({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orgApi<{ entries: AuditEntry[] }>(`/api/orgs/${slug}/audit`)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the audit log."));
  }, [slug]);
  if (error) return <Card><p className="text-sm text-muted">{error}</p></Card>;
  if (!entries) return <Card><p className="text-sm text-muted">Loading…</p></Card>;
  return (
    <Card className="grid gap-2">
      <p className="text-sm text-muted">Every change, and every time someone viewed a member or exported data. Latest 200.</p>
      <ul className="grid text-sm">
        {entries.map((a, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-0">
            <span>
              {a.action}
              {a.targetEmail && <span className="text-muted"> · {a.targetEmail}</span>}
            </span>
            <span className="text-muted">{a.actorEmail ?? "system"} · {dateTime(a.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
