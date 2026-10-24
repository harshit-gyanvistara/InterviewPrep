import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb, orgIdFrom } from "@/lib/orgAdmin";
import { installKit } from "@/lib/orgKits";
import { parseBody } from "@/lib/route";
import { KitBodySchema } from "@/lib/schemas";

// Super-admin: apply a starter kit to an existing organisation (plans/b2b-college.md B.7). Once per org.

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  try {
    const user = await requireSuperAdmin();
    const orgId = await orgIdFrom(ctx);
    const { kitId } = await parseBody(req, KitBodySchema);
    return NextResponse.json(await installKit(adminDb(), user, orgId, kitId), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
