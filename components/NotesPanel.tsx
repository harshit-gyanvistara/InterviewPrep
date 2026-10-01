"use client";

import { useMemo, useState } from "react";
import { Link2, Search, StickyNote, X } from "lucide-react";
import { NoteCard } from "./notes/NoteCard";
import { NoteEditor } from "./notes/NoteEditor";
import { useNoteList } from "@/lib/db";
import { NOTE_TYPE_LABEL } from "@/lib/notes";
import { useNotesPanel } from "@/lib/notesContext";

/**
 * The one global notes surface: a slide-over reachable from any page via the floating button,
 * the "n" shortcut, or any per-item "Note" button that opens it pre-attached to that item.
 */
export function NotesPanel() {
  const { state, closePanel } = useNotesPanel();
  const { data: all = [] } = useNoteList();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    let list = all;
    if (state.filterLink) list = list.filter((n) => n.links.some((l) => l.type === state.filterLink!.type && l.id === state.filterLink!.id));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)));
    return list;
  }, [all, state.filterLink, query]);

  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button aria-label="Close notes" className="absolute inset-0 bg-black/30" onClick={closePanel} />
      <aside
        className="glass absolute right-0 top-0 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] shadow-2xl sm:right-3 sm:top-3 sm:h-[calc(100vh-1.5rem)] sm:rounded-[1.75rem] sm:pt-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-medium"><StickyNote size={19} /> Notes</h2>
          <button onClick={closePanel} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-soft">
            <X size={18} />
          </button>
        </div>

        {state.filterLink && (
          <div className="flex items-center justify-between rounded-2xl bg-hl px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5"><Link2 size={12} /> Showing notes for {NOTE_TYPE_LABEL[state.filterLink.type]}: {state.filterLink.label}</span>
          </div>
        )}

        <div className="rounded-2xl bg-card p-3.5">
          <NoteEditor key={state.filterLink ? `${state.filterLink.type}-${state.filterLink.id}` : "none"} initialLink={state.filterLink} initialBody={state.prefillBody} onDone={() => {}} autoFocus />
        </div>

        {!state.filterLink && (
          <label className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}

        <div className="grid flex-1 content-start gap-3">
          {shown.length === 0 ? (
            <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted">{state.filterLink ? "No notes here yet — add one above." : all.length === 0 ? "No notes yet. Press \"n\" anywhere to add one." : "No notes match your search."}</p>
          ) : (
            shown.map((n) => <NoteCard key={n.id} note={n} onNavigate={closePanel} />)
          )}
        </div>
      </aside>
    </div>
  );
}
