import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { attention } from "@/lib/orgAttention";
import { orgForMember } from "@/lib/orgInvites";

// Who needs a nudge: members behind on due work, and those at risk by score (plans/b2b-college.md B.10).
// Needs analytics.view; follows each member's sharing choice, and a coach sees only their own part.

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await attention(db, org, Date.now()), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
