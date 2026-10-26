"use client";

import { ArrowDown } from "lucide-react";

/**
 * Phones only: on /practice the interviewer, settings and start button stack below the whole
 * round list, so this bar keeps the next step on screen. Put it as the last child of the list's
 * (non-grid) wrapper: it sticks to the bottom while the list is in view and parks under the list
 * once the settings scroll in. The wrapper needs min-w-0, or the one-line value widens the grid.
 *
 * It lines up with the notes button (NotesFab, 4.75rem above the bottom) and stops short of it on
 * the right. Sticky offsets count from inside <main>'s pb-20, which already clears the tab bar
 * (MobileNav), so 5rem - 0.25rem = 4.75rem; the tab bar's safe-area padding is added back.
 */
export function NextStepBar({ label, value, targetId }: { label: string; value: string; targetId: string }) {
  const next = () => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="glass sticky bottom-[calc(env(safe-area-inset-bottom)_-_0.25rem)] z-40 mt-3 mr-15 flex h-12 items-center gap-2 rounded-xl pr-1.5 pl-4 sm:mr-16 lg:hidden">
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
      <button onClick={next} className="btn btn-primary shrink-0 py-1.5">
        Next <ArrowDown size={15} />
      </button>
    </div>
  );
}
