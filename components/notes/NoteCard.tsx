"use client";

import Link from "next/link";
import { useState } from "react";
import { Link2, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { useConfirm } from "@/lib/dialogContext";
import { NOTE_TYPE_LABEL, noteLinkHref } from "@/lib/notes";
import { NoteEditor } from "./NoteEditor";
import type { Note } from "@/lib/types";

export function NoteCard({ note, onNavigate }: { note: Note; onNavigate?: () => void }) {
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();

  if (editing) {
    return (
      <div className="rounded-2xl bg-soft p-4">
        <NoteEditor note={note} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-soft p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{note.title}</h3>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            aria-label={note.pinned ? "Unpin" : "Pin"}
            onClick={() => db.notes.put({ ...note, pinned: !note.pinned })}
            className={`grid h-7 w-7 place-items-center rounded-full hover:bg-card ${note.pinned ? "text-accent" : "text-muted"}`}
          >
            {note.pinned ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
          <button aria-label="Edit" onClick={() => setEditing(true)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-card">
            <Pencil size={13} />
          </button>
          <button
            aria-label="Delete"
            onClick={async () => (await confirm({ message: "Delete this note?", danger: true })) && db.notes.remove(note.id)}
            className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-card hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      {note.body && <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{note.body}</p>}
      {(note.tags.length > 0 || note.links.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {note.links.map((l) => (
            <Link key={`${l.type}-${l.id}`} href={noteLinkHref(l)} onClick={onNavigate} className="flex items-center gap-1 rounded-full bg-hl px-2.5 py-0.5 text-[11px] hover:opacity-80">
              <Link2 size={10} /> {NOTE_TYPE_LABEL[l.type]}: {l.label}
            </Link>
          ))}
          {note.tags.map((t) => (
            <span key={t} className="rounded-full bg-card px-2.5 py-0.5 text-[11px] text-muted">
              {t}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">{new Date(note.updatedAt).toLocaleString()}</p>
    </div>
  );
}
