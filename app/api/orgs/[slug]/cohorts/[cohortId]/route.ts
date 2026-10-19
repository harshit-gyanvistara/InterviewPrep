import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { updateCohort } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { CohortUpdateBodySchema } from "@/lib/schemas";

// Rename or archive a cohort (plans/m2-org.md O.5). Needs cohorts.manage.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; cohortId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, cohortId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await updateCohort(db, user, org, cohortId, await parseBody(req, CohortUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
