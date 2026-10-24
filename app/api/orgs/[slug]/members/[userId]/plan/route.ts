import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { memberPlans } from "@/lib/orgWaivers";

// A member's plans and where they are in them, for staff (plans/b2b-college.md B.9). Needs members.view_reports;
// progress against score gates is withheld when the member shares less than scores.

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; userId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    return NextResponse.json(await memberPlans(db, await orgForMember(db, user, slug), userId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
