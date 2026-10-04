import { NextResponse } from "next/server";
import { ApiError, callAgent, type Agent } from "@/lib/liveAgent";

/** Connection test used by Settings → Data & AI: is liveAgent up, and can it reach both Gemini models? */
export async function GET() {
  try {
    return NextResponse.json(await callAgent<Agent["ModelsHealth"]>("/v1/health/models"));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ ok: false, hasKey: false, error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
