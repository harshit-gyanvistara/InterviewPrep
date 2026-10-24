import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { updateTrajectory } from "@/lib/orgTrajectories";
import { parseBody } from "@/lib/route";
import { TrajectoryUpdateBodySchema } from "@/lib/schemas";

// Edit or archive a plan (plans/b2b-college.md B.6). Runs already given out keep their own copies.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; trajectoryId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, trajectoryId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await updateTrajectory(db, user, org, trajectoryId, await parseBody(req, TrajectoryUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
