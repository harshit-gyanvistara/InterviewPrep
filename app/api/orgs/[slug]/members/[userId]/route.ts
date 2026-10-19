import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { memberDetail, removeMember, updateMember } from "@/lib/orgDashboard";
import { parseBody } from "@/lib/route";
import { MemberUpdateBodySchema } from "@/lib/schemas";

// One member of an organisation (plans/m2-org.md O.5, O.6). GET: their org practice at their share
// level (members.view_reports; recorded in the audit log). PATCH: role (members.manage) and/or
// cohort (cohorts.manage). DELETE: remove them (members.manage).

type Ctx = { params: Promise<{ slug: string; userId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    return NextResponse.json(await memberDetail(db, user, await orgForMember(db, user, slug), userId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    const org = await orgForMember(db, user, slug);
    await updateMember(db, user, org, userId, await parseBody(req, MemberUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { slug, userId } = await ctx.params;
    const db = adminDb();
    await removeMember(db, user, await orgForMember(db, user, slug), userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
