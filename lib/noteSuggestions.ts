import type { Note, NoteLink, Report } from "./types";

// Notes suggested from one interview's report (plans/note-suggestions.md). Rules over what the
// report already holds, so there is no AI call: free, instant, and works with AUTH_MODE=off.
// To add a source (an AI call, patterns across reports), return more NoteSuggestions with their
// own key prefix; the page and the accept/discard record don't change.

export type SuggestionKind = "fix" | "rehearse" | "skill" | "delivery" | "story";

export interface NoteSuggestion {
  /** Stable for this report, e.g. "fix:0", "rehearse:2", "skill:Communication". */
  key: string;
  kind: SuggestionKind;
  title: string;
  body: string;
  tags: string[];
}

/** Thresholds and how many of each kind to offer. One place to tune them. */
export const SUGGESTION_RULES = {
  maxFixes: 2,
  /** Answers at or below this score (0-10) get a "rehearse" note with the stronger version. */
  weakAnswer: 5,
  maxRehearse: 2,
  /** The weakest assessed skill gets a note when it scores below this (0-10). */
  weakSkill: 6,
  /** Filler words per 100 words, and a minimum count so one "um" in a short answer doesn't count. */
  fillerRate: 5,
  minFillers: 5,
  /** The best answer at or above this score is suggested as a story to reuse. */
  strongAnswer: 8,
};

const MAX_TITLE = 70;
const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
const fits = (text: string) => tidy(text).length <= MAX_TITLE;
const clip = (text: string) => {
  const t = tidy(text);
  if (t.length <= MAX_TITLE) return t;
  const cut = t.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}…`;
};

/** All suggestions for a report, most useful first, including ones already accepted or discarded. */
export function suggestNotes(report: Report): NoteSuggestion[] {
  const R = SUGGESTION_RULES;
  const out: NoteSuggestion[] = [];

  report.topFixes.slice(0, R.maxFixes).forEach((fix, i) => {
    // The body repeats the fix only when the title had to cut it short.
    if (fix.trim()) out.push({ key: `fix:${i}`, kind: "fix", title: `Fix: ${clip(fix)}`, body: fits(fix) ? "" : fix.trim(), tags: ["fix"] });
  });

  report.answerReviews
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => typeof a.score === "number" && a.score <= R.weakAnswer && a.betterAnswer?.trim())
    .sort((x, y) => x.a.score - y.a.score || x.i - y.i)
    .slice(0, R.maxRehearse)
    .forEach(({ a, i }) => {
      const parts = [...(fits(a.question) ? [] : [`Q: ${a.question.trim()}`]), `A stronger version: ${a.betterAnswer.trim()}`];
      if (a.expectedAnswer?.trim()) parts.push(`What the interviewer expected: ${a.expectedAnswer.trim()}`);
      out.push({ key: `rehearse:${i}`, kind: "rehearse", title: `Rehearse: ${clip(a.question)}`, body: parts.join("\n\n"), tags: ["rehearse"] });
    });

  const weakest = report.dimensions
    .filter((d) => d.assessed !== false && d.score < R.weakSkill && d.feedback?.trim())
    .sort((x, y) => x.score - y.score)[0];
  if (weakest) {
    const body = weakest.evidence?.trim() ? `${weakest.feedback.trim()}\n\nYou said: "${weakest.evidence.trim()}"` : weakest.feedback.trim();
    out.push({ key: `skill:${weakest.name}`, kind: "skill", title: `Skill: ${weakest.name} (${weakest.score.toFixed(1)}/10)`, body, tags: ["skill", weakest.name.toLowerCase()] });
  }

  const s = report.signals;
  if (s && s.fillerRate >= R.fillerRate && s.fillerCount >= R.minFillers) {
    const top = s.topFillers.slice(0, 3).map((f) => `"${f.word}" ×${f.count}`).join(", ");
    out.push({
      key: "fillers",
      kind: "delivery",
      title: "Delivery: cut filler words",
      body: `${s.fillerRate} filler words per 100 words${top ? ` (most used: ${top})` : ""}. Pause for a second instead of filling the gap.`,
      tags: ["delivery"],
    });
  }

  const best = report.answerReviews
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => typeof a.score === "number" && a.score >= R.strongAnswer && a.answerSummary?.trim())
    .sort((x, y) => y.a.score - x.a.score || x.i - y.i)[0];
  if (best) {
    out.push({
      key: `story:${best.i}`,
      kind: "story",
      title: `Reuse: ${clip(best.a.question)}`,
      body: `Scored ${best.a.score}/10. What you said: ${best.a.answerSummary.trim()}`,
      tags: ["story"],
    });
  }

  return out;
}

/** Suggestions the person hasn't accepted or discarded yet. */
export const pendingSuggestions = (report: Report) => suggestNotes(report).filter((s) => !report.noteSuggestions?.[s.key]);

/** The note an accepted suggestion becomes: linked to the interview and to its round. */
export function noteFromSuggestion(s: NoteSuggestion, report: Report, packTitle: string, id: string, now: number): Note {
  const links: NoteLink[] = [
    { type: "session", id: report.sessionId, label: packTitle },
    { type: "pack", id: report.packId, label: packTitle },
  ];
  return { id, title: s.title, body: s.body, tags: s.tags, links, pinned: false, createdAt: now, updatedAt: now };
}
