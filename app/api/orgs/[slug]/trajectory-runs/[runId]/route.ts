import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { deleteRun } from "@/lib/orgTrajectories";

// Take a plan back from the people it was given to (plans/b2b-college.md B.6).

export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string; runId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, runId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await deleteRun(db, user, org, runId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
