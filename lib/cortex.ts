import { db, uid } from "./db";
import type { AnswerReview, Binder, CortexPage, DimensionScore } from "./types";

export const DEFAULT_BINDERS: { name: string; icon: string }[] = [
  { name: "Behavioural Stories", icon: "🎯" },
  { name: "Technical Notes", icon: "🧠" },
  { name: "Company Research", icon: "🏢" },
  { name: "Interview Reports", icon: "📋" },
];

/** First-run seeding: give a brand-new Cortex a few starter binders instead of a blank sidebar. */
export async function ensureSeedBinders(): Promise<Binder[]> {
  const existing = await db.binders.list();
  if (existing.length > 0) return existing;
  const now = Date.now();
  const created: Binder[] = [];
  for (const b of DEFAULT_BINDERS) {
    const binder: Binder = { id: uid(), name: b.name, icon: b.icon, createdAt: now };
    await db.binders.put(binder);
    created.push(binder);
  }
  return created;
}

/** Finds a binder by name, creating it if it doesn't exist yet — used for cross-feature "save into Cortex" actions. */
export async function ensureBinder(name: string, icon: string): Promise<Binder> {
  const existing = (await db.binders.list()).find((b) => b.name === name);
  if (existing) return existing;
  const binder: Binder = { id: uid(), name, icon, createdAt: Date.now() };
  await db.binders.put(binder);
  return binder;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turns a scored interview report into a formatted Cortex page the person can keep annotating. */
export function reportToHtml(opts: { packTitle: string; overall: number; verdict: string; summary: string; topFixes: string[]; dimensions: DimensionScore[]; answerReviews: AnswerReview[] }): string {
  const { packTitle, overall, verdict, summary, topFixes, dimensions, answerReviews } = opts;
  return [
    `<h2>${esc(packTitle)} — ${overall}/100 (${esc(verdict)})</h2>`,
    `<p>${esc(summary)}</p>`,
    `<h3>Top fixes</h3>`,
    `<ul>${topFixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`,
    `<h3>Rubric</h3>`,
    `<ul>${dimensions.map((d) => `<li><strong>${esc(d.name)}: ${d.score}/10</strong> — ${esc(d.feedback)}</li>`).join("")}</ul>`,
    `<h3>Questions to study</h3>`,
    ...answerReviews.map(
      (a) =>
        `<blockquote><p><strong>${esc(a.question)}</strong></p><p>${esc(a.feedback)}</p><p><strong>What was expected:</strong> ${esc(a.expectedAnswer)}</p></blockquote>`,
    ),
  ].join("\n");
}

export async function createPage(binderId: string, opts?: { title?: string; icon?: string; contentHtml?: string }): Promise<CortexPage> {
  const now = Date.now();
  const page: CortexPage = {
    id: uid(),
    binderId,
    title: opts?.title ?? "Untitled page",
    icon: opts?.icon ?? "📄",
    contentHtml: opts?.contentHtml ?? "",
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.cortexPages.put(page);
  return page;
}

/** Plain text extracted from a page's HTML, for search and word counts. */
export function htmlToText(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]*>/g, " ");
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

export function wordCount(html: string): number {
  const text = htmlToText(html).trim();
  return text ? text.split(/\s+/).length : 0;
}

export const PAGE_ICONS = ["📄", "🎯", "🧠", "🏢", "📋", "💡", "🔥", "⭐", "🚀", "📌", "🗂️", "🧩", "🎤", "💻", "📊", "✅"];
export const BINDER_ICONS = ["📚", "🎯", "🧠", "🏢", "📋", "💡", "🔥", "🗂️", "🧩", "🎤", "💻", "📊", "✍️", "📁"];
