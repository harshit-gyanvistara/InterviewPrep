import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { loadInterview } from "@/lib/interviewContext";
import { agentDomain, callAgentWithMeta, errorResponse, type Agent } from "@/lib/liveAgent";
import { PERSONAS } from "@/lib/packs";
import { addUsage } from "@/lib/policies";
import { authorize, parseBody } from "@/lib/route";
import { ReportBodySchema } from "@/lib/schemas";

// Scoring runs on the Pro model and can take a while.
export const maxDuration = 120;

/**
 * Scores the finished interview against the pack's rubric. The prompt and Gemini call live in
 * liveAgent. Signed in, the transcript, profile and pack come from the database, not the body (M2.6).
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, "interview.report");
    const body = await parseBody(req, ReportBodySchema);
    const ctx = await loadInterview(user, body.sessionId, body.context);

    const { domains } = await getCatalog();
    const { data: out, meta } = await callAgentWithMeta<Agent["ReportResult"]>(
      "/v1/interview/report",
      {
        config: ctx.config,
        profile: ctx.profile,
        pack: ctx.pack,
        domain: agentDomain(resolveDomain(ctx.profile, undefined, domains)),
        interviewerName: PERSONAS[ctx.config.persona].name,
        messages: ctx.messages.map(({ role, text }) => ({ role, text })),
        code: body.code,
      } satisfies Agent["ReportRequest"],
      { user, timeoutMs: 115_000 },
    );
    await ctx.save({ code: body.code, call: "report", meta });
    await addUsage(user, "mocks", { orgId: ctx.orgId });
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
