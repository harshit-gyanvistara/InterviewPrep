import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { createAssignment, listAssignments } from "@/lib/orgCohorts";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { AssignmentCreateBodySchema } from "@/lib/schemas";

// An organisation's assignments with completion, and setting new ones (plans/m2-org.md O.5).
// Needs assignments.create.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json({ assignments: await listAssignments(db, org) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await createAssignment(db, user, org, await parseBody(req, AssignmentCreateBodySchema)), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
