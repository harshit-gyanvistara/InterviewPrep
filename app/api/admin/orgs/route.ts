import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb, createOrg, listOrgs } from "@/lib/orgAdmin";
import { parseBody } from "@/lib/route";
import { OrgCreateBodySchema } from "@/lib/schemas";

// Super-admin: list and create organisations (plans/m2-org.md O.1). 404 for anyone not in SUPER_ADMIN_EMAILS.

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ orgs: await listOrgs(adminDb()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSuperAdmin();
    const body = await parseBody(req, OrgCreateBodySchema);
    return NextResponse.json(await createOrg(adminDb(), user, body), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
