import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { updateGroup } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { GroupUpdateBodySchema } from "@/lib/schemas";

// Rename, archive or set the members of a group (plans/b2b-college.md B.2). Needs cohorts.manage.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; groupId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, groupId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await updateGroup(db, user, org, groupId, await parseBody(req, GroupUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
