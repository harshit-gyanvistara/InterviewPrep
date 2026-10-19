import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb, setEntitlements, orgIdFrom } from "@/lib/orgAdmin";
import { parseBody } from "@/lib/route";
import { EntitlementsBodySchema } from "@/lib/schemas";

// Super-admin: replace an organisation's plan, i.e. its entitlement rows (plans/m2-org.md O.1, D13).

export async function PUT(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  try {
    const user = await requireSuperAdmin();
    const orgId = await orgIdFrom(ctx);
    const { entitlements } = await parseBody(req, EntitlementsBodySchema);
    await setEntitlements(adminDb(), user, orgId, entitlements);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
