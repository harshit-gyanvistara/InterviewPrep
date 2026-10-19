import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { addOwner, adminDb, orgIdFrom } from "@/lib/orgAdmin";
import { parseBody } from "@/lib/route";
import { OrgOwnerBodySchema } from "@/lib/schemas";

// Super-admin: make someone an owner of an organisation, or invite them as one (plans/m2-org.md O.1).

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  try {
    const user = await requireSuperAdmin();
    const orgId = await orgIdFrom(ctx);
    const { email } = await parseBody(req, OrgOwnerBodySchema);
    return NextResponse.json(await addOwner(adminDb(), user, orgId, email));
  } catch (e) {
    return errorResponse(e);
  }
}
