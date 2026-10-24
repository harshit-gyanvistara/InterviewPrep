import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { setSectionContext } from "@/lib/orgContextAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { ContextBodySchema } from "@/lib/schemas";

// One section's context, which refines the organisation's (plans/b2b-college.md B.8). Owners and admins.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; cohortId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, cohortId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await setSectionContext(db, user, org, cohortId, (await parseBody(req, ContextBodySchema)).context);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
