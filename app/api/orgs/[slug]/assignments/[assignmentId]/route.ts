import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { deleteAssignment } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";

// Remove an assignment (plans/m2-org.md O.5). Sessions already done for it keep their record.

export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string; assignmentId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, assignmentId } = await ctx.params;
    const db = adminDb();
    await deleteAssignment(db, user, await orgForMember(db, user, slug), assignmentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
