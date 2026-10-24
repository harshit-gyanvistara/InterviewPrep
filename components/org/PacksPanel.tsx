"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Copy, Pencil, Plus } from "lucide-react";
import { Card } from "@/components/Shell";
import { useCatalog } from "@/lib/db";
import { ROUND_TYPES, type Pack, type RoundType } from "@/lib/types";
import { orgApi } from "./api";

// The organisation's own rounds (plans/b2b-college.md B.5): start from a built-in round or blank,
// edit its topics and scoring points, archive it. For people with packs.create.

interface Form {
  title: string;
  company: string;
  role: string;
  roundType: RoundType;
  durationMin: string;
  description: string;
  style: string;
  topics: string;
  rubric: string;
}

const BLANK: Form = { title: "", company: "", role: "", roundType: "behavioural", durationMin: "20", description: "", style: "", topics: "", rubric: "" };
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const toForm = (p: Pack, title = p.title): Form => ({
  title,
  company: p.company,
  role: p.role,
  roundType: p.roundType,
  durationMin: String(p.durationMin),
  description: p.description,
  style: p.style,
  topics: p.topics.join("\n"),
  rubric: p.rubric.join("\n"),
});

export function PacksPanel({ slug }: { slug: string }) {
  const { catalog } = useCatalog();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPacks((await orgApi<{ packs: Pack[] }>(`/api/orgs/${slug}/packs`)).packs);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't load rounds.");
    }
  }, [slug]);
  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    const body = {
      title: form.title.trim(),
      company: form.company.trim(),
      role: form.role.trim(),
      roundType: form.roundType,
      durationMin: Number(form.durationMin) || 0,
      description: form.description.trim(),
      style: form.style.trim(),
      topics: lines(form.topics),
      rubric: lines(form.rubric),
    };
    try {
      if (editing) await orgApi(`/api/orgs/${slug}/packs/${editing}`, { method: "PATCH", body });
      else await orgApi(`/api/orgs/${slug}/packs`, { method: "POST", body });
      closeForm();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save the round.");
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setEditing(null);
    setForm({ ...BLANK });
  };
  const startEdit = (p: Pack) => {
    setEditing(p.id);
    setForm(toForm(p));
  };
  const closeForm = () => {
    setForm(null);
    setEditing(null);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="grid gap-5">
      <Card className="grid gap-3">
        <h2 className="text-sm font-semibold">Your rounds</h2>
        <p className="text-sm text-muted">Mock interviews written for your organisation. Members see them when practising for you, and you can assign them like any other round. Editing a round doesn&apos;t change mocks already taken.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={startNew}><Plus size={15} /> New round</button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Copy size={14} aria-hidden />
            <select
              className="input w-auto !py-1.5"
              value=""
              aria-label="Copy a built-in round"
              onChange={(e) => {
                const base = catalog.packs.find((p) => p.id === e.target.value);
                if (!base) return;
                setEditing(null);
                setForm(toForm(base, `${base.title} (ours)`));
              }}
            >
              <option value="">Copy a built-in round…</option>
              {catalog.packs.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.durationMin} min</option>)}
            </select>
          </label>
        </div>
        {packs.length === 0 ? (
          <p className="text-sm text-muted">None yet. Copy a built-in round to start from something good.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {packs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className={p.archived ? "text-muted line-through" : ""}>
                  <b>{p.title}</b> <span className="text-muted">· {p.roundType} · {p.durationMin} min{p.company ? ` · ${p.company}` : ""}</span>
                </span>
                <span className="flex items-center gap-3 text-muted">
                  <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => startEdit(p)}><Pencil size={14} /> Edit</button>
                  <button
                    className="inline-flex items-center gap-1 hover:text-ink"
                    onClick={async () => {
                      try {
                        await orgApi(`/api/orgs/${slug}/packs/${p.id}`, { method: "PATCH", body: { archived: !p.archived } });
                        await load();
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : "Couldn't save.");
                      }
                    }}
                  >
                    {p.archived ? <><ArchiveRestore size={14} /> Restore</> : <><Archive size={14} /> Archive</>}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {form && (
        <Card className="grid gap-3">
          <h2 className="text-sm font-semibold">{editing ? "Edit round" : "New round"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">Title<input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Campus HR round" /></label>
            <label className="grid gap-1.5 text-sm">
              Type
              <select className="input" value={form.roundType} onChange={(e) => set("roundType", e.target.value as RoundType)}>
                {ROUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">Company (optional)<input className="input" value={form.company} onChange={(e) => set("company", e.target.value)} /></label>
            <label className="grid gap-1.5 text-sm">Role (optional)<input className="input" value={form.role} onChange={(e) => set("role", e.target.value)} /></label>
            <label className="grid gap-1.5 text-sm">Minutes (5 to 120)<input className="input" inputMode="numeric" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value.replace(/\D/g, ""))} /></label>
            <label className="grid gap-1.5 text-sm">Description (optional)<input className="input" value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
          </div>
          <label className="grid gap-1.5 text-sm">
            Topics to cover (one per line)
            <textarea className="input min-h-24" value={form.topics} onChange={(e) => set("topics", e.target.value)} placeholder={"Tell me about yourself\nWhy this company\nStrengths and weaknesses"} />
          </label>
          <label className="grid gap-1.5 text-sm">
            What the interviewer scores (one per line)
            <textarea className="input min-h-24" value={form.rubric} onChange={(e) => set("rubric", e.target.value)} placeholder={"Communication\nStructure\nRole fit"} />
          </label>
          <label className="grid gap-1.5 text-sm">
            Interviewer style (optional)
            <textarea className="input min-h-16" value={form.style} onChange={(e) => set("style", e.target.value)} placeholder="Warm but probing; asks for a concrete example." />
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save round"}</button>
            <button className="btn btn-ghost" onClick={closeForm}>Cancel</button>
          </div>
        </Card>
      )}
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </div>
  );
}
