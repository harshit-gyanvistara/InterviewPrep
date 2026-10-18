import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { agentDomain, callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import { PERSONAS } from "@/lib/packs";
import { addUsage } from "@/lib/policies";
import { authorize, parseBody } from "@/lib/route";
import { ReportBodySchema } from "@/lib/schemas";

// Scoring runs on the Pro model and can take a while.
export const maxDuration = 120;

/** Scores the finished interview against the pack's rubric. The prompt and Gemini call live in liveAgent. */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, "interview.report");
    const body = await parseBody(req, ReportBodySchema);

    const { domains } = await getCatalog();
    const out = await callAgent<Agent["ReportResult"]>(
      "/v1/interview/report",
      {
        config: body.config,
        profile: body.profile,
        pack: body.pack,
        domain: agentDomain(resolveDomain(body.profile, undefined, domains)),
        interviewerName: PERSONAS[body.config.persona].name,
        messages: body.messages,
        code: body.code,
      } satisfies Agent["ReportRequest"],
      { user, timeoutMs: 115_000 },
    );
    await addUsage(user, "mocks");
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
