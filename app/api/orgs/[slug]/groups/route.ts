import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { createGroup, listGroups } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { GroupCreateBodySchema } from "@/lib/schemas";

// An organisation's ad-hoc groups (plans/b2b-college.md B.2). Needs cohorts.manage.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ groups: await listGroups(db, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const { name, memberIds } = await parseBody(req, GroupCreateBodySchema);
    return NextResponse.json(await createGroup(db, user, org, name, memberIds), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
