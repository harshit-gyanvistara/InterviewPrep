import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { ApiError, agentDomain, agentPersona, callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import { PERSONAS, isValidPack } from "@/lib/packs";
import type { Message, Pack, Profile, SessionConfig } from "@/lib/types";

/** The interviewer's next line. The prompt and Gemini call live in liveAgent. */
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
    if (!isValidPack(body.pack) || !body.profile || !PERSONAS[body.config?.persona]) throw new ApiError(400, "Invalid interview configuration.");

    const { domains } = await getCatalog();
    const out = await callAgent<Agent["TurnResult"]>("/v1/interview/turn", {
      config: body.config,
      profile: body.profile,
      pack: body.pack,
      persona: agentPersona(body.config.persona),
      domain: agentDomain(resolveDomain(body.profile, undefined, domains)),
      messages: body.messages ?? [],
      elapsedSec: body.elapsedSec ?? 0,
      code: body.code ?? "",
    } satisfies Agent["TurnRequest"]);
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
