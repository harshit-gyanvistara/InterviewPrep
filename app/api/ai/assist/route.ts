import { NextResponse } from "next/server";
import { ApiError, MODELS, Type, generateJson } from "@/lib/gemini";

const ALLOWED_TAGS = "h1, h2, h3, p, ul, ol, li, strong, em, u, s, blockquote, pre, code, a, hr";

/**
 * Shared AI writing assist for both the quick Notes drawer and the Cortex notebook editor.
 * mode "improve" rewrites/tidies existing content; mode "generate" drafts new content from a
 * topic or instruction. Always returns clean HTML restricted to tags both editors can render.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mode: "improve" | "generate";
      text?: string; // existing content (plain text or HTML) for "improve"
      instruction?: string; // topic / ask for "generate", or extra guidance for "improve"
      contextTitle?: string; // the note/page title, for relevance
    };

    if (body.mode === "improve" && !body.text?.trim()) throw new ApiError(400, "Nothing to improve yet — write something first.");
    if (body.mode === "generate" && !body.instruction?.trim() && !body.contextTitle?.trim()) throw new ApiError(400, "Say what you'd like written.");

    const system =
      body.mode === "improve"
        ? `You improve a person's interview-prep notes. Fix grammar and clarity, tighten wording, and organise it with clear structure (headings/bullets where that genuinely helps) — but preserve every fact and idea already there. Never invent new claims, numbers or achievements that aren't implied by the original text. ${body.instruction?.trim() ? `Also follow this specific instruction: ${body.instruction.trim()}` : ""}
Return ONLY clean HTML using just these tags: ${ALLOWED_TAGS}. No markdown, no code fences, no <html>/<body> wrapper, no commentary.`
        : `You write helpful, concrete interview-preparation notes for a graduate. Be practical and specific — frameworks, checklists, example phrasing, common pitfalls — not vague platitudes. Keep it focused and skimmable.
Return ONLY clean HTML using just these tags: ${ALLOWED_TAGS}. No markdown, no code fences, no <html>/<body> wrapper, no commentary.`;

    const userText =
      body.mode === "improve"
        ? `${body.contextTitle ? `TITLE: ${body.contextTitle}\n\n` : ""}CONTENT TO IMPROVE:\n${body.text!.slice(0, 12000)}`
        : `${body.contextTitle ? `PAGE TITLE: ${body.contextTitle}\n` : ""}WHAT TO WRITE: ${body.instruction?.trim() || "Notes relevant to this title."}`;

    const out = await generateJson<{ html: string }>({
      model: MODELS.chat,
      system,
      turns: [{ role: "user", text: userText }],
      temperature: body.mode === "improve" ? 0.4 : 0.7,
      schema: { type: Type.OBJECT, properties: { html: { type: Type.STRING } }, required: ["html"] },
    });

    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
