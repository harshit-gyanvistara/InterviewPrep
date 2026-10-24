import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { unwaiveStage, waiveStage } from "@/lib/orgWaivers";
import { parseBody } from "@/lib/route";
import { WaiverBodySchema, WaiverRemoveBodySchema } from "@/lib/schemas";

// Excuse a member from a plan stage, or take that back (plans/b2b-college.md B.9). Needs assignments.create;
// a coach only for members in their own part of the organisation. Both are written to the audit log.

type Ctx = { params: Promise<{ slug: string; userId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    const { assignmentId, reason } = await parseBody(req, WaiverBodySchema);
    await waiveStage(db, user, await orgForMember(db, user, slug), userId, assignmentId, reason);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    const { assignmentId } = await parseBody(req, WaiverRemoveBodySchema);
    await unwaiveStage(db, user, await orgForMember(db, user, slug), userId, assignmentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
