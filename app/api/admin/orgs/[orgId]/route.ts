import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb, getOrg, updateOrg, orgIdFrom } from "@/lib/orgAdmin";
import { parseBody } from "@/lib/route";
import { OrgUpdateBodySchema } from "@/lib/schemas";

// Super-admin: one organisation's details, and editing its name, kind and settings (plans/m2-org.md O.1).

type Ctx = { params: Promise<{ orgId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const orgId = await orgIdFrom(ctx);
    return NextResponse.json({ org: await getOrg(adminDb(), orgId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireSuperAdmin();
    const orgId = await orgIdFrom(ctx);
    await updateOrg(adminDb(), user, orgId, await parseBody(req, OrgUpdateBodySchema));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
