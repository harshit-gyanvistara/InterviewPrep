"use client";

import { usePathname } from "next/navigation";
import { StickyNote } from "lucide-react";
import { useNotesPanel } from "@/lib/notesContext";

/**
 * Rendered once at the root, outside the main glass container (which uses backdrop-filter and
 * would otherwise trap `fixed` positioning) so it stays pinned to the viewport on every screen.
 */
export function NotesFab() {
  const { openPanel, state } = useNotesPanel();
  const path = usePathname();
  const bare = path === "/welcome" || path === "/onboarding";
  const inInterview = path.startsWith("/interview/");
  if (state.open || bare) return null;

  // On phones, the bottom tab bar (see MobileNav) occupies this corner, so lift the button above
  // it — except during an interview, where there's no tab bar to clear.
  const bottomOffset = inInterview ? "bottom-[max(1.25rem,env(safe-area-inset-bottom))]" : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-8";

  return (
    <button
      onClick={() => openPanel()}
      aria-label="Open notes (press n)"
      title="Notes (press n)"
      className={`fixed right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-ink shadow-xl transition hover:scale-105 active:scale-95 sm:right-8 ${bottomOffset}`}
    >
      <StickyNote size={22} />
    </button>
  );
}
