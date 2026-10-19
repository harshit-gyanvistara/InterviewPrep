import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember, revokeInvite } from "@/lib/orgInvites";

// Revoke an invite or join code (plans/m2-org.md O.2). Needs members.manage.

export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string; inviteId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, inviteId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await revokeInvite(db, user, org, inviteId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
