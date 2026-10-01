import { NextResponse } from "next/server";
import { ApiError, MODELS, Type, generateJson } from "@/lib/gemini";
import { isValidPack } from "@/lib/prompts";
import { interviewerSystem, toTurns } from "@/lib/prompts";
import type { Message, Pack, Profile, SessionConfig } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      config: SessionConfig;
      profile: Profile;
      pack: Pack;
      messages: Message[];
      elapsedSec: number;
      code?: string;
    };
    const pack = body.pack;
    if (!isValidPack(pack) || !body.profile) throw new ApiError(400, "Invalid interview configuration.");

    const interviewerTurnsSoFar = (body.messages ?? []).filter((m) => m.role === "interviewer").length;
    const out = await generateJson<{ reply: string; endInterview: boolean }>({
      model: MODELS.chat,
      system: interviewerSystem(pack, body.config, body.profile, body.elapsedSec ?? 0, body.code ?? "", interviewerTurnsSoFar),
      turns: toTurns((body.messages ?? []).slice(-60)),
      temperature: body.config.persona === "tough" ? 0.8 : 0.7,
      schema: {
        type: Type.OBJECT,
        properties: {
          reply: { type: Type.STRING },
          endInterview: { type: Type.BOOLEAN },
        },
        required: ["reply", "endInterview"],
      },
    });
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
