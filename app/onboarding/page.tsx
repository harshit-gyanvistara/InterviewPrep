"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Card } from "@/components/Shell";
import { DeviceCheck } from "@/components/DeviceCheck";
import { db, uid, useCatalog, useProfile } from "@/lib/db";
import { inferDomain } from "@/lib/domains";
import type { Profile } from "@/lib/types";

const STEPS = ["About you", "Your goal", "Resume", "Device check", "Ready"];

export default function Onboarding() {
  const router = useRouter();
  const { data: existing, loading } = useProfile();
  const { catalog } = useCatalog();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);

  if (loading) return null;

  const v = <K extends keyof Profile>(k: K, fallback: Profile[K]): Profile[K] => (draft[k] ?? existing?.[k] ?? fallback) as Profile[K];
  const set = <K extends keyof Profile>(k: K, val: Profile[K]) => setDraft((d) => ({ ...d, [k]: val }));

  const name = v("name", "");
  const targetRole = v("targetRole", "");
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? targetRole.trim().length > 0 : true;

  const finish = async (to: string) => {
    setSaving(true);
    await db.profiles.put({
      id: existing?.id ?? uid(),
      createdAt: existing?.createdAt ?? Date.now(),
      name: name.trim(),
      targetRole: targetRole.trim(),
      targetCompanies: v("targetCompanies", "").trim(),
      jobDescription: v("jobDescription", "").trim(),
      experience: v("experience", "fresher"),
      domain: v("domain", "") || undefined,
      resume: v("resume", "").trim(),
      interviewDate: v("interviewDate", "") || undefined,
      weeklyGoal: v("weeklyGoal", 3),
      onboarded: true,
    });
    router.push(to);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-6 flex items-center justify-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={`grid h-7 w-7 place-items-center rounded-full font-semibold ${i < step ? "bg-ok text-white" : i === step ? "bg-accent text-accent-ink" : "bg-soft text-muted"}`}>
              {i < step ? <Check size={14} /> : i + 1}
            </span>
            <span className={`hidden sm:block ${i === step ? "font-medium" : "text-muted"}`}>{s}</span>
            {i < STEPS.length - 1 && <span className="hidden h-px w-5 bg-line sm:block" />}
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && (
          <div className="grid gap-4">
            <h1 className="text-3xl font-light">First, who are we preparing?</h1>
            <p className="text-sm text-muted">This works for any profession — engineering, business, healthcare, design, teaching, whatever you&apos;re aiming for.</p>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Your name</span>
              <input autoFocus className="input" value={name} onChange={(e) => set("name", e.target.value)} placeholder="Aarav Sharma" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Where are you now?</span>
              <select className="input" value={v("experience", "fresher")} onChange={(e) => set("experience", e.target.value as Profile["experience"])}>
                <option value="student">Student (pre-final year)</option>
                <option value="fresher">Fresher / final year</option>
                <option value="0-1y">0–1 year of experience</option>
                <option value="1-3y">1–3 years of experience</option>
              </select>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <h1 className="text-3xl font-light">What are you aiming for?</h1>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Target role</span>
              <input className="input" value={targetRole} onChange={(e) => set("targetRole", e.target.value)} placeholder="e.g. Business Analyst, Nurse, Software Engineer, Copywriter" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Field (shapes the rounds and how your interviewer asks)</span>
              <select className="input" value={v("domain", "") ?? ""} onChange={(e) => set("domain", e.target.value)}>
                <option value="">Detect from my role{targetRole.trim() ? ` (${inferDomain({ targetRole, jobDescription: v("jobDescription", "") }, catalog.domains).label})` : ""}</option>
                {catalog.domains.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Target companies (optional)</span>
              <input className="input" value={v("targetCompanies", "")} onChange={(e) => set("targetCompanies", e.target.value)} placeholder="Any companies you're targeting" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Job description (optional — the single best way to tailor your practice)</span>
              <textarea className="input min-h-28 resize-y" value={v("jobDescription", "")} onChange={(e) => set("jobDescription", e.target.value)} placeholder="Paste a real job posting for this role. We'll build interview rounds around exactly what it asks for." />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted">Interview or placement date (optional)</span>
                <input type="date" className="input" value={v("interviewDate", "") ?? ""} onChange={(e) => set("interviewDate", e.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted">Weekly goal</span>
                <select className="input" value={v("weeklyGoal", 3)} onChange={(e) => set("weeklyGoal", +e.target.value)}>
                  {[1, 2, 3, 5, 7].map((n) => (<option key={n} value={n}>{n} mock{n > 1 ? "s" : ""} per week</option>))}
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <h1 className="text-3xl font-light">Add your resume</h1>
            <p className="text-sm text-muted">Paste the text. Your interviewer will ask about your real projects. You can skip this and add it later in Settings.</p>
            <textarea className="input min-h-56 resize-y" value={v("resume", "")} onChange={(e) => set("resume", e.target.value)} placeholder="Education, projects, internships, skills…" />
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <h1 className="text-3xl font-light">Check your setup</h1>
            <p className="text-sm text-muted">A quick test now avoids surprises in the interview. Nothing here is required.</p>
            <DeviceCheck />
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-4 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok text-white"><Check size={28} /></span>
            <h1 className="text-3xl font-light">You&apos;re set, {name.split(" ")[0]}</h1>
            <p className="mx-auto max-w-md text-sm text-muted">
              {v("jobDescription", "") ? "We'll build interview rounds from the job description you pasted." : "We recommend a 15-minute baseline behavioural interview. It shows where you stand and personalises your plan."}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <button disabled={saving} onClick={() => finish("/practice")} className="btn btn-primary">
                {v("jobDescription", "") ? "Build my interview rounds" : "Take my baseline mock"}
              </button>
              <button disabled={saving} onClick={() => finish("/")} className="btn btn-ghost">Go to dashboard</button>
            </div>
          </div>
        )}

        {step < 4 && (
          <div className="mt-6 flex items-center justify-between">
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button>
            <div className="flex gap-2">
              {step === 2 && <button className="btn btn-ghost" onClick={() => setStep(3)}>Skip</button>}
              <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
