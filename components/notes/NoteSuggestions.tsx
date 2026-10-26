"use client";

import { useState } from "react";
import { Check, Lightbulb, X } from "lucide-react";
import { db, uid } from "@/lib/db";
import { noteFromSuggestion, pendingSuggestions, type NoteSuggestion } from "@/lib/noteSuggestions";
import type { Report } from "@/lib/types";

/** Records the choice on the report, re-read first so two quick clicks don't overwrite each other. */
async function record(report: Report, key: string, status: "accepted" | "discarded") {
  const latest = (await db.reports.get(report.id)) ?? report;
  await db.reports.put({ ...latest, noteSuggestions: { ...latest.noteSuggestions, [key]: status } });
}

/**
 * Notes suggested from one interview's report. Accept saves a normal note linked to the interview
 * and its round; Discard hides the suggestion. Renders nothing once every suggestion is handled.
 */
export function NoteSuggestions({
  report,
  packTitle,
  title = "Suggested notes",
  className = "",
  children,
}: {
  report: Report;
  packTitle: string;
  title?: string;
  className?: string;
  /** Shown beside the heading, e.g. a link to the report. */
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const pending = pendingSuggestions(report);
  if (pending.length === 0) return null;

  const handle = async (s: NoteSuggestion, status: "accepted" | "discarded") => {
    setBusy(s.key);
    try {
      if (status === "accepted") {
        await db.notes.put(noteFromSuggestion(s, report, packTitle, uid(), Date.now()));
      }
      await record(report, s.key, status);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`grid gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Lightbulb size={15} className="text-accent" /> {title} <span className="font-normal text-muted">· {pending.length}</span>
        </h3>
        {children}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((s) => {
          const long = s.body.length > 160;
          const expanded = open.has(s.key);
          return (
            <div key={s.key} className="flex min-w-0 flex-col rounded-2xl border border-dashed border-line p-4">
              <h4 className="text-sm font-medium">{s.title}</h4>
              {s.body && <p className={`mt-1 whitespace-pre-wrap text-sm text-muted ${long && !expanded ? "line-clamp-4" : ""}`}>{s.body}</p>}
              {long && (
                <button
                  onClick={() => setOpen((o) => (o.has(s.key) ? new Set([...o].filter((k) => k !== s.key)) : new Set(o).add(s.key)))}
                  className="mt-1 w-fit text-xs text-muted underline"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
              <div className="mt-auto flex gap-2 pt-3">
                <button onClick={() => handle(s, "accepted")} disabled={busy !== null} className="btn btn-primary flex-1 py-1.5">
                  <Check size={14} /> Accept
                </button>
                <button onClick={() => handle(s, "discarded")} disabled={busy !== null} className="btn btn-ghost flex-1 py-1.5">
                  <X size={14} /> Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
