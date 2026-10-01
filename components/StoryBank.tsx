"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/Shell";
import { NoteChip } from "@/components/NoteChip";
import { db, uid, useStories } from "@/lib/db";
import { useConfirm } from "@/lib/dialogContext";
import type { Story } from "@/lib/types";

const TAGS = ["Leadership", "Conflict", "Failure", "Teamwork", "Ownership", "Technical challenge", "Deadline", "Learning"];
const empty = { title: "", situation: "", task: "", action: "", result: "", tags: [] as string[] };

export function StoryBank() {
  const { data: stories = [] } = useStories();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Story | "new" | null>(null);
  const [form, setForm] = useState(empty);

  const open = (s: Story | "new") => {
    setEditing(s);
    setForm(s === "new" ? empty : { title: s.title, situation: s.situation, task: s.task, action: s.action, result: s.result, tags: s.tags });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await db.stories.put({ id: editing !== "new" && editing ? editing.id : uid(), createdAt: editing !== "new" && editing ? editing.createdAt : Date.now(), ...form });
    setEditing(null);
  };

  const toggleTag = (t: string) => setForm((f) => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] }));

  if (editing)
    return (
      <Card>
        <form onSubmit={save} className="grid gap-4">
          <h2 className="text-lg font-medium">{editing === "new" ? "New story" : "Edit story"}</h2>
          <input required className="input" placeholder="Title (e.g. Fixed the payment bug before launch)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {(["situation", "task", "action", "result"] as const).map((k) => (
            <label key={k} className="grid gap-1.5 text-sm">
              <span className="font-medium capitalize">{k}</span>
              <textarea className="input min-h-20" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                placeholder={{ situation: "What was the context?", task: "What was your responsibility?", action: "What exactly did YOU do?", result: "What happened? Add numbers." }[k]} />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => (
              <button type="button" key={t} onClick={() => toggleTag(t)} className={`rounded-full px-3 py-1 text-xs ${form.tags.includes(t) ? "bg-accent text-accent-ink" : "bg-soft"}`}>{t}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <button className="btn btn-primary">Save story</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      </Card>
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">Write 5–6 strong stories once. Most behavioural questions can be answered with one of them.</p>
        <button className="btn btn-primary" onClick={() => open("new")}><Plus size={16} /> New story</button>
      </div>
      {stories.length === 0 ? (
        <Card><p className="text-sm text-muted">No stories yet. Start with your hardest project and a time you disagreed with someone.</p></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stories.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{s.title}</h3>
                <span className="flex shrink-0 items-center gap-1">
                  <NoteChip link={{ type: "story", id: s.id, label: s.title }} />
                  <button aria-label="Edit" onClick={() => open(s)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-soft"><Pencil size={14} /></button>
                  <button
                    aria-label="Delete"
                    onClick={async () => (await confirm({ message: "Delete this story?", danger: true })) && db.stories.remove(s.id)}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-soft hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{s.tags.map((t) => (<span key={t} className="rounded-full bg-soft px-2 py-0.5 text-[11px] text-muted">{t}</span>))}</div>
              <dl className="mt-3 grid gap-1.5 text-sm text-muted">
                {(["situation", "task", "action", "result"] as const).map((k) => s[k] && (<div key={k}><dt className="inline font-medium capitalize text-ink">{k}: </dt><dd className="inline">{s[k]}</dd></div>))}
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
