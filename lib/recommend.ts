import { BASELINE_PACK_ID } from "./packs";
import type { Pack, Report, Session } from "./types";

const RULES: { re: RegExp; roundType: Pack["roundType"] }[] = [
  { re: /code|complexity|testing|edge/i, roundType: "coding" },
  { re: /technical|depth|correct|problem|quantitative|structuring/i, roundType: "technical" },
  { re: /clarity|attitude|company|organisation|confidence|consisten/i, roundType: "hr" },
  { re: /ownership|structure|specific|principle|contribution|star|learning|judgement/i, roundType: "behavioural" },
];

export function weakestDimension(reports: Report[]): string | undefined {
  const scores = new Map<string, number[]>();
  reports.slice(0, 3).forEach((r) => r.dimensions.forEach((d) => scores.set(d.name, [...(scores.get(d.name) ?? []), d.score])));
  return [...scores.entries()]
    .map(([name, v]) => ({ name, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.avg - b.avg)[0]?.name;
}

export interface Recommendation {
  pack: Pack;
  reason: string;
}

/** Recommends a round from whatever packs are actually available to this profile (built-in + generated from their JD). */
export function recommendPack(reports: Report[], packs: Pack[]): Recommendation {
  if (packs.length === 0) throw new Error("No packs available to recommend from.");
  const jdPack = packs.find((p) => p.source === "jd");

  if (reports.length === 0) {
    if (jdPack) return { pack: jdPack, reason: "Generated from your job description — the closest thing to your real interview." };
    return { pack: packs.find((p) => p.id === BASELINE_PACK_ID) ?? packs[0], reason: "Take a baseline mock so we can find your weak spots." };
  }

  const weak = weakestDimension(reports);
  const rule = weak && RULES.find((r) => r.re.test(weak));
  if (rule) {
    const match = packs.find((p) => p.roundType === rule.roundType && p.id !== reports[0].packId);
    if (match) return { pack: match, reason: `Your weakest area recently is “${weak}”. This round drills it.` };
  }

  const lastDone = new Map<string, number>();
  reports.forEach((r) => lastDone.set(r.packId, Math.max(lastDone.get(r.packId) ?? 0, r.createdAt)));
  const least = [...packs].sort((a, b) => (lastDone.get(a.id) ?? 0) - (lastDone.get(b.id) ?? 0))[0];
  return { pack: least, reason: lastDone.has(least.id) ? "You haven't practised this round in a while." : "You haven't tried this round yet." };
}

export function daysUntil(date?: string): number | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00").getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

export function sessionsThisWeek(sessions: Session[]) {
  const since = Date.now() - 7 * 86400000;
  return sessions.filter((s) => s.status === "done" && s.startedAt >= since).length;
}

export function streakDays(times: number[]) {
  const days = new Set(times.map((t) => new Date(t).toDateString()));
  let n = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
