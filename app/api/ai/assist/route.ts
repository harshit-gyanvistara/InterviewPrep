import { NextResponse } from "next/server";
import { callAgent, errorResponse, type Agent } from "@/lib/liveAgent";
import { parseBody } from "@/lib/route";
import { AssistBodySchema } from "@/lib/schemas";

/**
 * Shared AI writing assist for both the quick Notes drawer and the Cortex notebook editor.
 * mode "improve" rewrites/tidies existing content; mode "generate" drafts new content from a
 * topic or instruction. Always returns clean HTML restricted to tags both editors can render.
 * The prompt, validation and Gemini call live in liveAgent.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, AssistBodySchema);
    const out = await callAgent<Agent["AssistResult"]>("/v1/assist", {
      mode: body.mode,
      text: body.text,
      instruction: body.instruction,
      contextTitle: body.contextTitle,
    } satisfies Agent["AssistRequest"]);
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
