import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { joinOrg, previewInvite } from "@/lib/orgInvites";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { JoinBodySchema } from "@/lib/schemas";

// Opening and accepting an invite link or join code (plans/m2-org.md O.2). Signed in only, and
// rate-limited per user so short join codes can't be guessed.

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    await enforceRateLimit(req, "org.join", { userId: user.id });
    return NextResponse.json(await previewInvite(adminDb(), user, decodeURIComponent((await ctx.params).token)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    await enforceRateLimit(req, "org.join", { userId: user.id });
    const { shareLevel } = await parseBody(req, JoinBodySchema);
    return NextResponse.json(await joinOrg(adminDb(), user, decodeURIComponent((await ctx.params).token), shareLevel));
  } catch (e) {
    return errorResponse(e);
  }
}
