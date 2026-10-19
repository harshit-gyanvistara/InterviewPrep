import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { setMemberCohort } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { MemberCohortBodySchema } from "@/lib/schemas";

// Move a member into a cohort, or out of one (plans/m2-org.md O.5). Needs cohorts.manage.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; userId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    const { cohortId } = await parseBody(req, MemberCohortBodySchema);
    await setMemberCohort(db, user, org, userId, cohortId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
