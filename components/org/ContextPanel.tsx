"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Shell";
import { CONTEXT_KEYS, CONTEXT_LABELS, CONTEXT_MAX_CHARS, type ContextFields } from "@/lib/orgContext";
import type { ContextView } from "@/lib/orgContextAdmin";
import { orgApi } from "./api";

// What this organisation's interviews reflect (plans/b2b-college.md B.8): its own context, refined per
// section. Owners and admins. Applies to practice started afterwards; mocks already under way keep
// the context they started with.

function Fields({ value, onChange }: { value: ContextFields; onChange: (v: ContextFields) => void }) {
  return (
    <div className="grid gap-3">
      {CONTEXT_KEYS.map((k) => (
        <label key={k} className="grid gap-1.5 text-sm">
          {CONTEXT_LABELS[k].label}
          <textarea className="input min-h-16" maxLength={CONTEXT_MAX_CHARS} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} placeholder={CONTEXT_LABELS[k].hint} />
        </label>
      ))}
    </div>
  );
}

export function ContextPanel({ slug }: { slug: string }) {
  const [view, setView] = useState<ContextView | null>(null);
  const [org, setOrg] = useState<ContextFields | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContextFields | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await orgApi<ContextView>(`/api/orgs/${slug}/context`);
      setView(v);
      setOrg(v.org);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load.");
    }
  }, [slug]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (url: string, value: ContextFields, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await orgApi(url, { method: "PATCH", body: { context: value } });
      setMsg(done);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  if (!view || !org) return <Card><p className="text-sm text-muted">{msg ?? "Loading…"}</p></Card>;

  return (
    <div className="grid gap-5">
      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">For everyone in the organisation</h2>
        <p className="text-sm text-muted">Tell the interviewer what you prepare people for, so its questions fit. It only applies to practice done for your organisation, never to anyone&apos;s own practice. Start a new mock to see a change; mocks already under way keep what they started with.</p>
        <Fields value={org} onChange={setOrg} />
        <div><button className="btn btn-primary" disabled={busy} onClick={() => save(`/api/orgs/${slug}/context`, org, "Saved.")}>Save</button></div>
      </Card>

      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Per section</h2>
        <p className="text-sm text-muted">A section&apos;s own entries replace the organisation&apos;s for the same field, and apply to every section below it. A field left empty uses the one above.</p>
        {view.sections.length === 0 && <p className="text-sm text-muted">No sections yet. Add them under Cohorts.</p>}
        <ul className="grid gap-1 text-sm">
          {view.sections.filter((s) => !s.archived).map((s) => (
            <li key={s.id} className="border-b border-line py-2 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span>{s.path}</span>
                <button
                  className="text-muted hover:text-ink"
                  onClick={() => {
                    setOpen(open === s.id ? null : s.id);
                    setDraft(s.context);
                  }}
                >
                  {open === s.id ? "Close" : CONTEXT_KEYS.some((k) => s.context[k]) ? "Edit" : "Add"}
                </button>
              </div>
              {open === s.id && draft && (
                <div className="mt-3 grid gap-3">
                  <Fields value={draft} onChange={setDraft} />
                  <div><button className="btn btn-primary" disabled={busy} onClick={() => save(`/api/orgs/${slug}/cohorts/${s.id}/context`, draft, `Saved ${s.path}.`)}>Save section</button></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {msg && <p className="rounded-lg bg-card px-3 py-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}
