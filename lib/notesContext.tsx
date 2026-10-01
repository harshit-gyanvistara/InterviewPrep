"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { NoteLink } from "./types";

interface PanelState {
  open: boolean;
  /** When set, the panel shows only notes attached to this thing, and new notes are pre-attached to it. */
  filterLink?: NoteLink;
  /** Pre-fills the body of a new note, e.g. a quoted interview answer. */
  prefillBody?: string;
}

interface NotesCtxValue {
  state: PanelState;
  openPanel: (opts?: { filterLink?: NoteLink; prefillBody?: string }) => void;
  closePanel: () => void;
}

const NotesCtx = createContext<NotesCtxValue | null>(null);

/**
 * Makes the notes drawer reachable from anywhere: mount once near the root, then any component
 * can call useNotesPanel().openPanel(...) to pop it open, optionally pre-attached to whatever
 * that component represents (a session, a pack, a roadmap item, a story...).
 */
export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PanelState>({ open: false });

  const openPanel = useCallback((opts?: { filterLink?: NoteLink; prefillBody?: string }) => {
    setState({ open: true, filterLink: opts?.filterLink, prefillBody: opts?.prefillBody });
  }, []);
  const closePanel = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  // Global "n" shortcut for quick capture, unless the person is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      openPanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPanel]);

  const value = useMemo(() => ({ state, openPanel, closePanel }), [state, openPanel, closePanel]);
  return <NotesCtx.Provider value={value}>{children}</NotesCtx.Provider>;
}

export function useNotesPanel() {
  const ctx = useContext(NotesCtx);
  if (!ctx) throw new Error("useNotesPanel must be used inside <NotesProvider>");
  return ctx;
}
