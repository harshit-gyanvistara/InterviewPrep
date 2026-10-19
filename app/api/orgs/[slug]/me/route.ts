import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { leaveOrg, setShareLevel } from "@/lib/orgMembership";
import { parseBody } from "@/lib/route";
import { JoinBodySchema } from "@/lib/schemas";

// The signed-in member's own membership of one organisation (plans/m2-org.md O.3):
// PATCH changes what the org may see, DELETE leaves it.

type Ctx = { params: Promise<{ slug: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const { shareLevel } = await parseBody(req, JoinBodySchema);
    await setShareLevel(db, user, org, shareLevel);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    await leaveOrg(db, user, await orgForMember(db, user, (await ctx.params).slug));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
