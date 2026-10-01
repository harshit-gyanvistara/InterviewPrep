"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, PageTitle } from "@/components/Shell";
import { ProfileForm } from "@/components/ProfileForm";
import { db, saveSettings, useProfile, useSettings } from "@/lib/db";
import { PERSONAS } from "@/lib/packs";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { useConfirm } from "@/lib/dialogContext";
import { useSpeak } from "@/lib/useSpeech";
import type { Persona, Settings as S } from "@/lib/types";

const TABS = ["Profile", "Interview", "Voice & audio", "Appearance", "Data & AI"] as const;
type Tab = (typeof TABS)[number];

export default function Settings() {
  const { data: profile, loading } = useProfile();
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>("Profile");
  if (loading) return null;

  const update = (patch: Partial<S>) => saveSettings(patch, settings);

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle title="Settings" />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm ${tab === t ? "bg-accent text-accent-ink" : "bg-card text-muted"}`}>{t}</button>
        ))}
      </div>

      {tab === "Profile" && <ProfileTab profile={profile} />}
      {tab === "Interview" && (
        <Card className="grid gap-5">
          <Field label="Default interviewer">
            <select className="input" value={settings.defaultPersona} onChange={(e) => update({ defaultPersona: e.target.value as Persona })}>
              {(Object.keys(PERSONAS) as Persona[]).map((k) => (<option key={k} value={k}>{PERSONAS[k].name} · {PERSONAS[k].label}</option>))}
            </select>
          </Field>
          <Field label="Default duration">
            <select className="input" value={settings.defaultDuration ?? "auto"} onChange={(e) => update({ defaultDuration: e.target.value === "auto" ? null : +e.target.value })}>
              <option value="auto">Use each round&apos;s own length</option>
              {[10, 15, 20, 30, 45].map((n) => (<option key={n} value={n}>{n} minutes</option>))}
            </select>
          </Field>
          <Toggle label="Pressure mode by default" hint="Interruptions, a curveball question and no hints." on={settings.defaultPressure} onChange={(v) => update({ defaultPressure: v })} />
          <Toggle label="Show countdown timer" on={settings.showTimer} onChange={(v) => update({ showTimer: v })} />
          <Toggle label="Confirm before ending an interview" on={settings.confirmEnd} onChange={(v) => update({ confirmEnd: v })} />
        </Card>
      )}
      {tab === "Voice & audio" && <VoiceTab settings={settings} update={update} />}
      {tab === "Appearance" && <AppearanceTab />}
      {tab === "Data & AI" && <DataTab />}
    </div>
  );
}

function ProfileTab({ profile }: { profile: ReturnType<typeof useProfile>["data"] }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <ProfileForm initial={profile} onSaved={() => setSaved(true)} cta="Save profile" />
      {saved && <p className="mt-3 text-sm text-ok">Saved.</p>}
    </Card>
  );
}

function VoiceTab({ settings, update }: { settings: S; update: (p: Partial<S>) => void }) {
  const { speak } = useSpeak();
  const [voices, setVoices] = useState<string[]>([]);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith("en")).map((v) => v.name) ?? []);
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  return (
    <Card className="grid gap-5">
      <Toggle label="Spoken interviewer" hint="The interviewer reads questions aloud. Off = text only." on={settings.voiceReply} onChange={(v) => update({ voiceReply: v })} />
      <Toggle label="Auto-listen after the interviewer speaks" hint="Your mic opens automatically so you can just answer." on={settings.autoListen} onChange={(v) => update({ autoListen: v })} />
      <Toggle label="Live captions" on={settings.captions} onChange={(v) => update({ captions: v })} />
      <Toggle label="Camera on when I join" on={settings.cameraDefault} onChange={(v) => update({ cameraDefault: v })} />
      <Field label="Interviewer voice">
        <select className="input" value={settings.voiceName} onChange={(e) => update({ voiceName: e.target.value })}>
          <option value="">Automatic</option>
          {voices.map((v) => (<option key={v}>{v}</option>))}
        </select>
      </Field>
      <Field label={`Speech speed: ${settings.speechRate.toFixed(1)}×`}>
        <input type="range" min={0.7} max={1.4} step={0.1} value={settings.speechRate} onChange={(e) => update({ speechRate: +e.target.value })} />
      </Field>
      <Field label="Your speech recognition language / accent">
        <select className="input" value={settings.recognitionLang} onChange={(e) => update({ recognitionLang: e.target.value })}>
          <option value="en-IN">English (India)</option>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="en-AU">English (Australia)</option>
        </select>
      </Field>
      <div><button className="btn btn-ghost" onClick={() => speak("This is how your interviewer will sound.", { rate: settings.speechRate, voiceName: settings.voiceName })}>Play sample</button></div>
    </Card>
  );
}

function AppearanceTab() {
  const [t, setT] = useState<Theme>("light");
  useEffect(() => {
    const sync = () => setT(getTheme());
    sync();
    window.addEventListener("interviewprep:theme", sync);
    return () => window.removeEventListener("interviewprep:theme", sync);
  }, []);
  return (
    <Card>
      <Field label="Theme">
        <div className="flex gap-3">
          {(["light", "dark"] as Theme[]).map((x) => (
            <button key={x} onClick={() => setTheme(x)} className={`btn ${t === x ? "btn-primary" : "btn-ghost"} capitalize`}>{x}</button>
          ))}
        </div>
      </Field>
    </Card>
  );
}

interface Health { ok: boolean; hasKey: boolean; error?: string; chat?: HealthRow; scoring?: HealthRow }
interface HealthRow { model: string; ok: boolean; ms: number; error?: string }

function DataTab() {
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [testing, setTesting] = useState(false);

  const exportData = async () => {
    const blob = new Blob([JSON.stringify(await db.exportAll(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "offerly-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file?: File) => {
    if (!file) return;
    try {
      await db.importAll(JSON.parse(await file.text()));
      setMsg("Imported.");
    } catch {
      setMsg("That file isn't a valid export.");
    }
  };

  const wipe = async () => {
    const ok = await confirm({
      title: "Delete all data?",
      message: "This deletes your profile, all sessions, reports, stories, notes and roadmaps from this browser. This cannot be undone.",
      confirmLabel: "Delete everything",
      danger: true,
    });
    if (ok) {
      await db.clearAll();
      router.push("/welcome");
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      setHealth(await (await fetch("/api/health")).json());
    } catch {
      setHealth({ ok: false, hasKey: false, error: "Could not reach the server." });
    }
    setTesting(false);
  };

  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="mb-1 text-lg font-medium">AI connection</h2>
        <p className="mb-4 text-sm text-muted">Checks your Gemini key and the two models the app uses.</p>
        <button className="btn btn-ghost" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
        {health && (
          <div className="mt-4 grid gap-2 text-sm">
            {health.error && <p className="text-danger">{health.error}</p>}
            {[health.chat, health.scoring].map((r, i) => r && (
              <div key={i} className={`rounded-2xl p-3 ${r.ok ? "bg-soft" : "bg-danger/10 text-danger"}`}>
                <b>{i === 0 ? "Interviewer model" : "Scoring model"}:</b> {r.model} — {r.ok ? `OK (${r.ms} ms)` : r.error}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-medium">Your data</h2>
        <p className="mb-4 text-sm text-muted">Everything lives in this browser&apos;s local storage. During a session, the transcript and your profile text are sent to Google&apos;s Gemini API to run the interview and scoring. Recordings are never stored.</p>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-ghost" onClick={exportData}>Export JSON</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importData(e.target.files?.[0])} />
          <button className="btn btn-danger" onClick={wipe}>Delete all data</button>
        </div>
        {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-muted">{hint}</div>}
      </div>
      <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-soft"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}
