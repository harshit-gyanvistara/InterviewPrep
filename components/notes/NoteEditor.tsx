"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Sparkles, WandSparkles, X } from "lucide-react";
import { aiAssist } from "@/lib/aiAssist";
import { htmlToText } from "@/lib/cortex";
import { db, uid } from "@/lib/db";
import { usePrompt } from "@/lib/dialogContext";
import { NOTE_TYPE_LABEL } from "@/lib/notes";
import type { Note, NoteLink } from "@/lib/types";

/** Add/edit form for a single note. Used both in the global drawer and the full /notes page. */
export function NoteEditor({
  note,
  initialLink,
  initialBody,
  onDone,
  onCancel,
  autoFocus = true,
}: {
  note?: Note;
  initialLink?: NoteLink;
  initialBody?: string;
  onDone: (note: Note) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? initialBody ?? "");
  const [tagsText, setTagsText] = useState((note?.tags ?? []).join(", "));
  const [links, setLinks] = useState<NoteLink[]>(note?.links ?? (initialLink ? [initialLink] : []));
  const [aiBusy, setAiBusy] = useState<"improve" | "generate" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const prompt = usePrompt();

  useEffect(() => {
    if (autoFocus) bodyRef.current?.focus();
  }, [autoFocus]);

  const removeLink = (i: number) => setLinks((ls) => ls.filter((_, idx) => idx !== i));

  const improve = async () => {
    if (!body.trim() || aiBusy) return;
    setAiBusy("improve");
    setAiError(null);
    try {
      const html = await aiAssist({ mode: "improve", text: body, contextTitle: title });
      setBody(htmlToText(html).trim());
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't improve this note.");
    } finally {
      setAiBusy(null);
    }
  };

  const writeForMe = async () => {
    if (aiBusy) return;
    const instruction = await prompt({ title: "Write for me", message: "What should this note cover?", placeholder: "e.g. STAR method for behavioural answers", defaultValue: title });
    if (!instruction) return;
    setAiBusy("generate");
    setAiError(null);
    try {
      const html = await aiAssist({ mode: "generate", instruction, contextTitle: title });
      setBody((b) => (b.trim() ? `${b.trim()}\n\n${htmlToText(html).trim()}` : htmlToText(html).trim()));
      if (!title.trim()) setTitle(instruction.slice(0, 60));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't write that.");
    } finally {
      setAiBusy(null);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) return;
    const now = Date.now();
    const saved: Note = {
      id: note?.id ?? uid(),
      title: title.trim() || body.trim().slice(0, 60),
      body: body.trim(),
      tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      links,
      pinned: note?.pinned ?? false,
      createdAt: note?.createdAt ?? now,
      updatedAt: now,
    };
    await db.notes.put(saved);
    if (!note) {
      // quick-add: clear the form for another note, but keep the same attached link/context
      setTitle("");
      setBody("");
      setTagsText("");
      bodyRef.current?.focus();
    }
    onDone(saved);
  };

  return (
    <form onSubmit={save} className="grid gap-2.5">
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((l, i) => (
            <span key={`${l.type}-${l.id}`} className="flex items-center gap-1 rounded-full bg-hl px-2.5 py-1 text-xs">
              <Link2 size={11} /> {NOTE_TYPE_LABEL[l.type]}: {l.label}
              <button type="button" onClick={() => removeLink(i)} aria-label="Remove link" className="ml-0.5 opacity-60 hover:opacity-100">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input className="input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        ref={bodyRef}
        className="input min-h-24 resize-y"
        placeholder="Write a note…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(e);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={writeForMe} disabled={!!aiBusy} className="flex items-center gap-1.5 rounded-full bg-hl px-3 py-1.5 text-xs disabled:opacity-50">
          {aiBusy === "generate" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Write for me
        </button>
        <button type="button" onClick={improve} disabled={!body.trim() || !!aiBusy} className="flex items-center gap-1.5 rounded-full bg-hl px-3 py-1.5 text-xs disabled:opacity-50">
          {aiBusy === "improve" ? <Loader2 size={12} className="animate-spin" /> : <WandSparkles size={12} />} Improve with AI
        </button>
      </div>
      {aiError && <p className="text-xs text-danger">{aiError}</p>}
      <input className="input" placeholder="Tags, comma separated (optional)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={!title.trim() && !body.trim()}>
          {note ? "Save changes" : "Add note"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
