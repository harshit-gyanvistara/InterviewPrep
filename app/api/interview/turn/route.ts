import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { agentDomain, agentPersona, callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import { parseBody } from "@/lib/route";
import { TurnBodySchema } from "@/lib/schemas";

/** The interviewer's next line. The prompt and Gemini call live in liveAgent. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, TurnBodySchema);

    const { domains } = await getCatalog();
    const out = await callAgent<Agent["TurnResult"]>("/v1/interview/turn", {
      config: body.config,
      profile: body.profile,
      pack: body.pack,
      persona: agentPersona(body.config.persona),
      domain: agentDomain(resolveDomain(body.profile, undefined, domains)),
      messages: body.messages,
      elapsedSec: body.elapsedSec,
      code: body.code,
    } satisfies Agent["TurnRequest"]);
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
