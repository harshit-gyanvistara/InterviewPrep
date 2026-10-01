"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { NoteCard } from "@/components/notes/NoteCard";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { useNoteList } from "@/lib/db";
import { NOTE_TYPE_LABEL } from "@/lib/notes";

export default function NotesPage() {
  const { data: notes = [], loading } = useNoteList();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const shown = useMemo(() => {
    let list = notes;
    if (tag) list = list.filter((n) => n.tags.includes(tag));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)));
    return list;
  }, [notes, tag, query]);

  if (loading) return null;

  return (
    <div>
      <PageTitle title="Notes" sub={'Everything you\'ve jotted down, from anywhere in the app — press "n" any time to add one.'} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 basis-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button onClick={() => setShowNew((v) => !v)} className="btn btn-primary shrink-0">
          {showNew ? <X size={16} /> : <Plus size={16} />} {showNew ? "Close" : "New note"}
        </button>
      </div>

      {tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button onClick={() => setTag(null)} className={`rounded-full px-3 py-1 text-xs ${!tag ? "bg-accent text-accent-ink" : "bg-card text-muted"}`}>All</button>
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(t)} className={`rounded-full px-3 py-1 text-xs ${tag === t ? "bg-accent text-accent-ink" : "bg-card text-muted"}`}>{t}</button>
          ))}
        </div>
      )}

      {showNew && (
        <Card className="mb-5">
          <NoteEditor onDone={() => setShowNew(false)} onCancel={() => setShowNew(false)} />
        </Card>
      )}

      {shown.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {notes.length === 0
              ? `No notes yet. Add one here, or from any ${Object.values(NOTE_TYPE_LABEL).join(", ").toLowerCase()} elsewhere in the app.`
              : "Nothing matches your search or filter."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}
