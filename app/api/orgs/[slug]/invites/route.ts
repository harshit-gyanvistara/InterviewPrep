import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { createInvites, listInvites, orgForMember } from "@/lib/orgInvites";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { InviteCreateBodySchema } from "@/lib/schemas";

// An organisation's open invites and join codes, and creating new ones (plans/m2-org.md O.2).
// Needs members.manage; inviting an owner needs org.billing.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ invites: await listInvites(db, user, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    await enforceRateLimit(req, "org.invite", { userId: user.id });
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const body = await parseBody(req, InviteCreateBodySchema);
    return NextResponse.json(await createInvites(db, user, org, body), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
