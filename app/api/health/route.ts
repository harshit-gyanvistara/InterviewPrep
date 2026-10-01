import { NextResponse } from "next/server";
import { MODELS, Type, generateJson } from "@/lib/gemini";

/** Connection test used by Settings → Data & AI. */
export async function GET() {
  const hasKey = !!process.env.GEMINI_API_KEY;
  if (!hasKey) return NextResponse.json({ ok: false, hasKey, error: "GEMINI_API_KEY is not set in web/.env.local" }, { status: 503 });

  const check = async (model: string) => {
    const t = Date.now();
    try {
      await generateJson<{ ok: boolean }>({
        model,
        system: "Reply with JSON {\"ok\": true}.",
        turns: [{ role: "user", text: "ping" }],
        schema: { type: Type.OBJECT, properties: { ok: { type: Type.BOOLEAN } }, required: ["ok"] },
        temperature: 0,
      });
      return { model, ok: true, ms: Date.now() - t };
    } catch (e) {
      return { model, ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const [chat, scoring] = await Promise.all([check(MODELS.chat), check(MODELS.scoring)]);
  return NextResponse.json({ ok: chat.ok && scoring.ok, hasKey, chat, scoring });
}
