import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { agentDomain, callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import { parseBody } from "@/lib/route";
import { RoadmapBodySchema } from "@/lib/schemas";

/** A week-by-week prep plan from recent report digests. The prompt and Gemini call live in liveAgent. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, RoadmapBodySchema);

    const domain = resolveDomain(body.profile, undefined, (await getCatalog()).domains);
    const out = await callAgent<Agent["RoadmapResult"]>("/v1/roadmap", {
      profile: body.profile,
      domain: agentDomain(domain),
      weeks: body.weeks,
      digests: body.digests,
    } satisfies Agent["RoadmapRequest"]);
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
