"use client";

import { Building2 } from "lucide-react";
import { practisingFor, saveSettings, useMyOrgs, useSettings } from "@/lib/db";

// "Practising for: Me / <org>" (plans/m2-org.md O.4). Only shown to people in at least one org.
// New interviews carry the choice; the server checks membership and stamps the session, and the
// interview then counts against that org's plan (decision G3).

export function PractisingFor({ className = "" }: { className?: string }) {
  const { data: orgs } = useMyOrgs();
  const { settings } = useSettings();
  if (!orgs?.length) return null;
  const current = practisingFor(settings, orgs);

  return (
    <label className={`flex items-center gap-1.5 rounded-lg px-2 text-sm text-muted ${className}`}>
      <Building2 size={15} aria-hidden />
      <span className="sr-only">Practising for</span>
      <select
        className="max-w-44 truncate bg-transparent py-1.5 text-sm font-medium text-ink outline-none"
        value={current?.id ?? ""}
        onChange={(e) => void saveSettings({ practisingFor: e.target.value || null }, settings)}
        aria-label="Practising for"
      >
        <option value="">Practising as me</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>For {o.name}</option>
        ))}
      </select>
    </label>
  );
}
