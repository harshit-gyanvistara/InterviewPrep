"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { SYNC_EVENT_NAME, pendingSaves } from "@/lib/db";

/** A quiet note while changes are waiting to reach the server (plans/server-history.md). Hidden when all is saved. */
export function SyncNote() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    pendingSaves().then((n) => alive && setPending(n));
    const onSync = (e: Event) => setPending((e as CustomEvent<number>).detail);
    window.addEventListener(SYNC_EVENT_NAME, onSync);
    return () => {
      alive = false;
      window.removeEventListener(SYNC_EVENT_NAME, onSync);
    };
  }, []);

  if (!pending) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn" role="status" title="Your changes are kept in this browser and sent when the connection is back.">
      <CloudOff size={13} /> Saving {pending} change{pending === 1 ? "" : "s"}…
    </span>
  );
}
