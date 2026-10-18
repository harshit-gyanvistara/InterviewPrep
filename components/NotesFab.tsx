"use client";

import { usePathname } from "next/navigation";
import { StickyNote } from "lucide-react";
import { isBarePage } from "@/lib/pages";
import { useNotesPanel } from "@/lib/notesContext";

/**
 * Rendered once at the root, outside the main glass container (which uses backdrop-filter and
 * would otherwise trap `fixed` positioning) so it stays pinned to the viewport on every screen.
 */
export function NotesFab() {
  const { openPanel, state } = useNotesPanel();
  const path = usePathname();
  const bare = isBarePage(path);
  const inInterview = path.startsWith("/interview/");
  // The interview room has its own notes button in its header (and "n" still works); a floating
  // button there would cover the answer box's send button.
  if (state.open || bare || inInterview) return null;

  // On phones, the bottom tab bar (see MobileNav) occupies this corner, so lift the button above it.
  const bottomOffset = "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-8";

  return (
    <button
      onClick={() => openPanel()}
      aria-label="Open notes (press n)"
      title="Notes (press n)"
      className={`fixed right-5 z-50 grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-ink shadow-float transition hover:scale-105 active:scale-95 sm:right-8 ${bottomOffset}`}
    >
      <StickyNote size={22} />
    </button>
  );
}
