"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, Loader2, Sparkles, Trash2, Zap } from "lucide-react";
import { Card, PageTitle } from "@/components/Shell";
import { NoteChip } from "@/components/NoteChip";
import { QuickMockBuilder } from "@/components/QuickMock";
import { db, uid, useAllPacks, useProfile, useReports, useSettings } from "@/lib/db";
import { useConfirm } from "@/lib/dialogContext";
import { PERSONAS, visibleBuiltInPacks } from "@/lib/packs";
import { recommendPack } from "@/lib/recommend";
import type { Pack, Persona } from "@/lib/types";

const SOURCE_BADGE: Record<string, string> = { jd: "From your JD", quick: "Quick Mock" };

export default function PracticePage() {
  return (
    <Suspense>
      <Practice />
    </Suspense>
  );
}

function Practice() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: profile, loading } = useProfile();
  const { data: reports = [] } = useReports();
  const { settings } = useSettings();
  const { custom: customPacks, catalog, loading: packsLoading } = useAllPacks();
  const confirm = useConfirm();

  const [mode, setMode] = useState<"single" | "quick">("single");
  const [packOverride, setPackOverride] = useState<string | null>(null);
  const [personaOverride, setPersonaOverride] = useState<Persona | null>(null);
  const [pressureOverride, setPressureOverride] = useState<boolean | null>(null);
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  if (loading || packsLoading || !profile) return null;

  const builtIn = visibleBuiltInPacks(profile, catalog);
  const packs: Pack[] = [...customPacks, ...builtIn];
  const mixablePacks = packs.filter((p) => p.source !== "quick"); // don't let people mix a mix
  const rec = recommendPack(reports, packs);
  const fromUrl = packs.find((p) => p.id === params.get("pack"))?.id;
  const packId = packOverride ?? fromUrl ?? rec.pack.id;
  const pack = packs.find((p) => p.id === packId) ?? rec.pack;
  const persona = personaOverride ?? settings.defaultPersona;
  const pressure = pressureOverride ?? settings.defaultPressure;
  const dur = durationOverride ?? settings.defaultDuration ?? pack.durationMin;

  const generateFromJD = async () => {
    setGenBusy(true);
    setGenError(null);
    try {
      const res = await fetch("/api/pack/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate rounds");
      const now = Date.now();
      const saved: Pack[] = [];
      for (const p of json.packs as Omit<Pack, "id" | "domains" | "source" | "createdAt">[]) {
        const pk: Pack = { ...p, id: `custom-${uid()}`, domains: "all", source: "jd", createdAt: now };
        await db.customPacks.put(pk);
        saved.push(pk);
      }
      if (saved[0]) setPackOverride(saved[0].id);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to generate rounds");
    } finally {
      setGenBusy(false);
    }
  };

  const deleteCustom = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirm({ message: "Delete this round?", danger: true }))) return;
    await db.customPacks.remove(id);
    if (packOverride === id) setPackOverride(null);
  };

  const start = async () => {
    const id = uid();
    await db.sessions.put({
      id,
      config: { packId: pack.id, persona, durationMin: dur, pressure },
      messages: [],
      code: "",
      startedAt: Date.now(),
      status: "lobby",
    });
    router.push(`/interview/${id}`);
  };

  return (
    <div>
      <PageTitle title="Choose your interview" sub="Pick the round, the interviewer and how hard they push. You'll get a briefing and device check before it starts." />

      <Card className="mb-5 bg-hl/60">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-medium"><Sparkles size={16} /> Build rounds from a job description</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              {profile.jobDescription
                ? "Generate (or regenerate) interview rounds tailored to the job description on your profile."
                : "Add a job description in Settings → Profile, then generate rounds built for that exact role — any profession."}
            </p>
          </div>
          <button onClick={generateFromJD} disabled={genBusy || !profile.jobDescription?.trim()} className="btn btn-primary shrink-0">
            {genBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {customPacks.length ? "Regenerate" : "Generate my rounds"}
          </button>
        </div>
        {!profile.jobDescription?.trim() && <a href="/settings" className="mt-2 inline-block text-xs text-muted underline">Add a job description →</a>}
        {genError && <p className="mt-3 text-sm text-danger">{genError}</p>}
      </Card>

      <div className="mb-5 inline-flex rounded-full bg-card p-1 text-sm">
        <button onClick={() => setMode("single")} className={`rounded-full px-5 py-2 ${mode === "single" ? "bg-accent text-accent-ink" : "text-muted"}`}>Choose a round</button>
        <button onClick={() => setMode("quick")} className={`rounded-full px-5 py-2 ${mode === "quick" ? "bg-accent text-accent-ink" : "text-muted"}`}>Quick Mock</button>
      </div>

      {mode === "quick" ? (
        <QuickMockBuilder packs={mixablePacks} settings={settings} />
      ) : (
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid gap-3 lg:col-span-2">
          {packs.map((p) => {
            const sel = packId === p.id;
            const tried = reports.filter((r) => r.packId === p.id);
            const best = tried.length ? Math.max(...tried.map((r) => r.overall)) : null;
            const choose = () => {
              setPackOverride(p.id);
              setDurationOverride(null);
            };
            return (
              // A div, not a button: it contains real nested buttons (the note chip, delete),
              // which HTML doesn't allow inside a <button>.
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={choose}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    choose();
                  }
                }}
                className={`cursor-pointer rounded-3xl p-5 text-left transition ${sel ? "bg-accent text-accent-ink" : "bg-card hover:bg-soft"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-lg font-medium">
                      {p.title}
                      {p.source && (
                        <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-normal ${sel ? "bg-white/20" : "bg-hl"}`}><Sparkles size={11} /> {SOURCE_BADGE[p.source]}</span>
                      )}
                      {p.id === rec.pack.id && !p.source && (
                        <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-normal ${sel ? "bg-white/20" : "bg-hl"}`}>Recommended</span>
                      )}
                    </div>
                    <div className={`text-sm ${sel ? "opacity-80" : "text-muted"}`}>{p.company} · {p.role}</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${sel ? "bg-white/15" : "bg-soft"}`}>
                      <Clock size={12} /> {p.durationMin} min
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <NoteChip link={{ type: "pack", id: p.id, label: p.title }} className={sel ? "!bg-white/15" : ""} />
                    </span>
                    {p.source && (
                      <button onClick={(e) => deleteCustom(p.id, e)} aria-label="Delete this round" className={`grid h-7 w-7 place-items-center rounded-full ${sel ? "hover:bg-white/15" : "hover:bg-card"}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                </div>
                <p className={`mt-2 text-sm ${sel ? "opacity-80" : "text-muted"}`}>{p.description}</p>
                <p className={`mt-2 text-xs ${sel ? "opacity-70" : "text-muted"}`}>{tried.length ? `Tried ${tried.length}× · best ${best}` : "Not tried yet"}</p>
              </div>
            );
          })}
        </div>

        <div className="grid content-start gap-5">
          <Card>
            <h3 className="mb-3 font-medium">Interviewer</h3>
            <div className="grid gap-2">
              {(Object.keys(PERSONAS) as Persona[]).map((k) => (
                <button key={k} onClick={() => setPersonaOverride(k)} className={`rounded-2xl p-3 text-left text-sm ${persona === k ? "bg-accent text-accent-ink" : "bg-soft"}`}>
                  <div className="font-medium">{PERSONAS[k].name} · {PERSONAS[k].label}</div>
                  <div className={persona === k ? "opacity-80" : "text-muted"}>{PERSONAS[k].blurb}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-medium">Settings</h3>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Duration: {dur} min</span>
              <input type="range" min={5} max={45} step={5} value={dur} onChange={(e) => setDurationOverride(+e.target.value)} />
            </label>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" checked={pressure} onChange={(e) => setPressureOverride(e.target.checked)} className="mt-1" />
              <span>
                <span className="flex items-center gap-1 font-medium"><Zap size={14} /> Pressure mode</span>
                <span className="text-muted">Interruptions, a curveball question and no hints.</span>
              </span>
            </label>
            <button onClick={start} className="btn btn-primary mt-5 w-full">Continue to lobby</button>
          </Card>
        </div>
      </div>
      )}
    </div>
  );
}
