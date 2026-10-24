import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { updateOrgPack } from "@/lib/orgPacks";
import { parseBody } from "@/lib/route";
import { OrgPackUpdateBodySchema } from "@/lib/schemas";

// Edit or archive one of the organisation's rounds (plans/b2b-college.md B.5). Needs packs.create.

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; packId: string }> }) {
  try {
    const user = await requireUser();
    const { slug, packId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await updateOrgPack(db, user, org, packId, await parseBody(req, OrgPackUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
