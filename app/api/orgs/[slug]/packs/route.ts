import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { createOrgPack, listOrgPacks } from "@/lib/orgPacks";
import { parseBody } from "@/lib/route";
import { OrgPackCreateBodySchema } from "@/lib/schemas";

// An organisation's own rounds (plans/b2b-college.md B.5). Needs packs.create.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ packs: await listOrgPacks(db, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await createOrgPack(db, user, org, await parseBody(req, OrgPackCreateBodySchema)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
