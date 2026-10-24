import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { assignTrajectory } from "@/lib/orgTrajectories";
import { parseBody } from "@/lib/route";
import { TrajectoryAssignBodySchema } from "@/lib/schemas";

// Give a plan to everyone, a cohort or a group (plans/b2b-college.md B.6).

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; trajectoryId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, trajectoryId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    return NextResponse.json(await assignTrajectory(db, user, org, trajectoryId, await parseBody(req, TrajectoryAssignBodySchema)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
