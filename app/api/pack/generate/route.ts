import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { ApiError, agentDomain, callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import type { Profile } from "@/lib/types";

// Pack generation runs on the Pro model and can take a while.
export const maxDuration = 120;

/**
 * Builds a small set of interview rounds tailored to the candidate's exact target role and
 * job description. This is what makes the app work for any profession: instead of a fixed
 * list of tech rounds, the rounds are derived from what the real job actually asks for.
 * The prompt and Gemini call live in liveAgent.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { profile: Profile };
    const p = body.profile;
    if (!p?.targetRole?.trim()) throw new ApiError(400, "Missing target role.");

    const domain = resolveDomain(p, undefined, (await getCatalog()).domains);
    const out = await callAgent<Agent["PacksResult"]>(
      "/v1/packs/generate",
      { profile: p, domain: agentDomain(domain) } satisfies Agent["PackGenerateRequest"],
      { timeoutMs: 115_000 },
    );
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
