import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";

// An organisation as one of its members sees it: name, address and what they may do there
// (plans/m2-org.md). 404 for anyone who isn't an active member.

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    const { id, name, slug, permissions, cohortId } = await orgForMember(adminDb(), user, (await ctx.params).slug);
    return NextResponse.json({ org: { id, name, slug }, permissions, cohortId: cohortId ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
