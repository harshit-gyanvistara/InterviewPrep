"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/Shell";
import { STARTER_KITS, kitById } from "@/lib/starterKits";
import { orgApi } from "./api";

// "Set up your organisation" (plans/b2b-college.md B.7): start from a ready-made kit of rounds, plans and
// settings. Shown to owners and admins until one has been applied (once per organisation).

export function SetupCard({ slug, kit, canApply, onApplied }: { slug: string; kit: { id: string; version: number } | null; canApply: boolean; onApplied: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (kit) {
    const name = kitById(kit.id)?.name ?? kit.id;
    return <p className="text-sm text-muted">Started from the &quot;{name}&quot; kit. Its rounds are under Rounds and its plans under Plans; both are yours to edit.</p>;
  }
  if (!canApply) return null;

  const apply = async (kitId: string) => {
    setBusy(kitId);
    setMsg(null);
    try {
      await orgApi(`/api/orgs/${slug}/kit`, { method: "POST", body: { kitId } });
      onApplied();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't apply the kit.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="grid gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} /> Set up your organisation</h2>
      <p className="text-sm text-muted">Start from a ready-made kit instead of an empty page. It adds mock rounds and plans to your organisation as copies you can edit, and sets sensible defaults. You can do this once.</p>
      {STARTER_KITS.map((k) => (
        <div key={k.id} className="grid gap-2 rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>{k.name}</b>
            <span className="text-xs text-muted">{k.rounds.length} rounds · {k.plans.length} plans</span>
          </div>
          <p className="text-sm text-muted">{k.description}</p>
          <div><button className="btn btn-primary" disabled={busy !== null} onClick={() => apply(k.id)}>{busy === k.id ? "Setting up…" : `Use ${k.name}`}</button></div>
        </div>
      ))}
      {msg && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>}
    </Card>
  );
}
