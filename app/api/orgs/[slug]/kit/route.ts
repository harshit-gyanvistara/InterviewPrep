import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { applyKit } from "@/lib/orgKits";
import { parseBody } from "@/lib/route";
import { KitBodySchema } from "@/lib/schemas";

// Apply a starter kit from the organisation's own page (plans/b2b-college.md B.7). Owners and admins; once per org.

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const { kitId } = await parseBody(req, KitBodySchema);
    return NextResponse.json(await applyKit(db, user, org, kitId), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
