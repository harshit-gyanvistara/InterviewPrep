import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";
import { resolveDomain } from "@/lib/domains";
import { loadInterview } from "@/lib/interviewContext";
import { agentDomain, agentPersona, callAgentWithMeta, errorResponse, type Agent } from "@/lib/liveAgent";
import { requireAllowance, requireOrgAllowance } from "@/lib/policies";
import { authorize, parseBody } from "@/lib/route";
import { TurnBodySchema } from "@/lib/schemas";
import type { Message } from "@/lib/types";

/**
 * The interviewer's next line. The prompt and Gemini call live in liveAgent. Signed in, the
 * transcript, profile and pack come from the database and the new lines are saved here (M2.6).
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, "interview.turn");
    const body = await parseBody(req, TurnBodySchema);
    const ctx = await loadInterview(user, body.sessionId, body.context);

    // A retried turn (same answer id) doesn't add the answer twice.
    const messages: Message[] =
      body.answer && !ctx.messages.some((m) => m.id === body.answer!.id) ? [...ctx.messages, { ...body.answer, role: "candidate" }] : ctx.messages;
    // A mock starts with the greeting (no messages yet). Checking only then means an interview
    // already under way can always finish; the mock is counted when its report is made.
    // Practice for an org counts against the org's plan, solo practice against the user's (decision G3).
    if (messages.length === 0) await (ctx.orgId ? requireOrgAllowance(ctx.orgId, "mocks") : requireAllowance(user, "mocks"));

    const { domains } = await getCatalog();
    const { data: out, meta } = await callAgentWithMeta<Agent["TurnResult"]>("/v1/interview/turn", {
      config: ctx.config,
      profile: ctx.profile,
      pack: ctx.pack,
      persona: agentPersona(ctx.config.persona),
      domain: agentDomain(resolveDomain(ctx.profile, undefined, domains)),
      messages: messages.map(({ role, text }) => ({ role, text })),
      elapsedSec: body.elapsedSec,
      code: body.code,
    } satisfies Agent["TurnRequest"], { user });

    const message: Message = { id: crypto.randomUUID(), role: "interviewer", text: out.reply, at: Math.round(body.elapsedSec * 1000) };
    await ctx.save({ messages: [...messages, message], code: body.code, call: "turn", meta });
    return NextResponse.json({ ...out, message });
  } catch (e) {
    return errorResponse(e);
  }
}
