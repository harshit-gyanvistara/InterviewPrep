import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { createBulkInvites } from "@/lib/orgBulkInvites";
import { orgForMember } from "@/lib/orgInvites";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { BulkInviteBodySchema } from "@/lib/schemas";

// Invite a whole list at once, placing people in sections (plans/b2b-college.md B.3). Needs members.manage.

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    await enforceRateLimit(req, "org.invite", { userId: user.id });
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await createBulkInvites(db, user, org, await parseBody(req, BulkInviteBodySchema)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
