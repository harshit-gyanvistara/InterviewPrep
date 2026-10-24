import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb, createOrg, listOrgs } from "@/lib/orgAdmin";
import { installKit } from "@/lib/orgKits";
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
    const { kitId, ...body } = await parseBody(req, OrgCreateBodySchema);
    const db = adminDb();
    const created = await createOrg(db, user, body);
    // The org exists even if the kit can't be applied (say, an unknown id); apply it again from the org's page.
    let kit: { rounds: number; plans: number } | null = null;
    let kitError: string | null = null;
    if (kitId) {
      try {
        kit = await installKit(db, user, created.id, kitId);
      } catch (e) {
        kitError = e instanceof Error ? e.message : "Couldn't apply the starter kit.";
      }
    }
    return NextResponse.json({ ...created, kit, kitError }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
