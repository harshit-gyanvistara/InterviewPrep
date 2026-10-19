import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { createCohort, listCohorts } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { CohortCreateBodySchema } from "@/lib/schemas";

// An organisation's cohorts (plans/m2-org.md O.5). Listing needs cohorts.manage or
// assignments.create; creating needs cohorts.manage.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ cohorts: await listCohorts(db, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const { name } = await parseBody(req, CohortCreateBodySchema);
    return NextResponse.json(await createCohort(db, user, org, name), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
