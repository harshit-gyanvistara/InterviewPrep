import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { createTrajectory, listTrajectories } from "@/lib/orgTrajectories";
import { parseBody } from "@/lib/route";
import { TrajectoryBodySchema } from "@/lib/schemas";

// An organisation's plans of stages (plans/b2b-college.md B.6). Needs assignments.create.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ trajectories: await listTrajectories(db, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await createTrajectory(db, user, org, await parseBody(req, TrajectoryBodySchema)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
