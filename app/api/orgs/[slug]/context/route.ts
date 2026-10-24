import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { getContexts, setOrgContext } from "@/lib/orgContextAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { parseBody } from "@/lib/route";
import { ContextBodySchema } from "@/lib/schemas";

// What the organisation's interviews reflect: its own context and each section's (plans/b2b-college.md B.8).
// Owners and admins (settings.manage).

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    return NextResponse.json(await getContexts(db, org), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    await setOrgContext(db, user, org, (await parseBody(req, ContextBodySchema)).context);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
