"use client";

import { useState } from "react";
import { db, uid, useCatalog } from "@/lib/db";
import { inferDomain } from "@/lib/domains";
import type { Profile } from "@/lib/types";

export function ProfileForm({ initial, onSaved, cta = "Save" }: { initial?: Profile; onSaved?: () => void; cta?: string }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [targetRole, setTargetRole] = useState(initial?.targetRole ?? "");
  const [targetCompanies, setTargetCompanies] = useState(initial?.targetCompanies ?? "");
  const [jobDescription, setJobDescription] = useState(initial?.jobDescription ?? "");
  const [experience, setExperience] = useState<Profile["experience"]>(initial?.experience ?? "fresher");
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [resume, setResume] = useState(initial?.resume ?? "");
  const [interviewDate, setInterviewDate] = useState(initial?.interviewDate ?? "");
  const [weeklyGoal, setWeeklyGoal] = useState(initial?.weeklyGoal ?? 3);
  const [saving, setSaving] = useState(false);
  const { catalog } = useCatalog();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await db.profiles.put({
      id: initial?.id ?? uid(),
      createdAt: initial?.createdAt ?? Date.now(),
      name: name.trim(),
      targetRole: targetRole.trim(),
      targetCompanies: targetCompanies.trim(),
      jobDescription: jobDescription.trim(),
      experience,
      domain: domain || undefined,
      resume: resume.trim(),
      interviewDate: interviewDate || undefined,
      weeklyGoal,
      onboarded: true,
    });
    setSaving(false);
    onSaved?.();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Your name</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Sharma" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Target role</span>
          <input className="input" required value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Business Analyst, Nurse, Software Engineer, Copywriter" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Target companies (optional)</span>
          <input className="input" value={targetCompanies} onChange={(e) => setTargetCompanies(e.target.value)} placeholder="Any companies you're targeting" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Experience</span>
          <select className="input" value={experience} onChange={(e) => setExperience(e.target.value as Profile["experience"])}>
            <option value="student">Student (pre-final year)</option>
            <option value="fresher">Fresher / final year</option>
            <option value="0-1y">0–1 year</option>
            <option value="1-3y">1–3 years</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Field</span>
          <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">Detect from my role{targetRole.trim() ? ` (${inferDomain({ targetRole, jobDescription }, catalog.domains).label})` : ""}</option>
            {catalog.domains.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Interview date (optional)</span>
          <input type="date" className="input" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-muted">Weekly goal (mock interviews)</span>
          <select className="input" value={weeklyGoal} onChange={(e) => setWeeklyGoal(+e.target.value)}>
            {[1, 2, 3, 5, 7].map((n) => (<option key={n} value={n}>{n} per week</option>))}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Job description (optional, but the more specific your practice)</span>
        <textarea
          className="input min-h-28 resize-y"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the job posting. We'll build interview rounds around what it actually asks for — for any profession."
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Resume text (paste it — the interviewer will ask about it)</span>
        <textarea
          className="input min-h-40 resize-y"
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          placeholder="Education, projects, work history, skills…"
        />
      </label>
      <div>
        <button className="btn btn-primary" disabled={saving || !name.trim()}>
          {cta}
        </button>
      </div>
    </form>
  );
}
