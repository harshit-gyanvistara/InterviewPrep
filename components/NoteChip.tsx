"use client";

import { StickyNote } from "lucide-react";
import { useNotesFor } from "@/lib/db";
import { useNotesPanel } from "@/lib/notesContext";
import type { NoteLink } from "@/lib/types";

/**
 * Drop this next to anything — a session, a pack, a roadmap item, a story — to let people attach
 * notes to it. Shows a count when notes already exist; clicking always opens the global drawer
 * filtered to just this thing, with a new note pre-attached and ready to type.
 */
export function NoteChip({ link, prefillBody, className = "", label }: { link: NoteLink; prefillBody?: string; className?: string; label?: string }) {
  const { notes } = useNotesFor(link);
  const { openPanel } = useNotesPanel();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openPanel({ filterLink: link, prefillBody });
      }}
      title={notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"} — click to view or add` : "Add a note"}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition hover:opacity-80 ${notes.length ? "bg-hl" : "bg-soft text-muted"} ${className}`}
    >
      <StickyNote size={12} />
      {label ?? (notes.length || "")}
    </button>
  );
}
